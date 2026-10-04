import React, { useState, useRef, useEffect } from 'react';
import { cx, Icon, Modal, fmtDate } from './ui.jsx';

// Downscale to max 1600px JPEG so photos stay light; originals would go to object storage in production.
export function compressImage(file, max = 1600, q = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ src: c.toDataURL('image/jpeg', q), w: c.width, h: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} is not an image the browser can read. Use JPG, PNG or HEIC from a phone camera.`)); };
    img.src = url;
  });
}

let seq = 0;
export async function filesToPhotos(files, by, stage) {
  const out = [];
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)) continue;
    if (f.size > 12 * 1024 * 1024) throw new Error(`${f.name} is larger than 12 MB.`);
    const r = await compressImage(f);
    out.push({ id: 'PH' + Date.now().toString(36) + (seq++), src: r.src, name: f.name, at: new Date().toISOString().slice(0, 16), by, stage, caption: '' });
  }
  return out;
}

export function CameraModal({ onClose, onShot, fallback }) {
  const video = useRef(null);
  const [err, setErr] = useState('');
  const [stream, setStream] = useState(null);
  useEffect(() => {
    let s;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
        setStream(s);
        if (video.current) { video.current.srcObject = s; await video.current.play(); }
      } catch (e) {
        setErr('The camera is not available here (no camera found or permission blocked). You can choose a photo file instead.');
      }
    })();
    return () => s && s.getTracks().forEach((t) => t.stop());
  }, []);
  const snap = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    c.width = v.videoWidth * k; c.height = v.videoHeight * k;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => onShot(new File([b], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.85);
  };
  return (
    <Modal title="Take photo" sub="Photograph the package, label and any damage." onClose={onClose}
      footer={<><button className="btn ghost" onClick={fallback}>Choose a file instead</button><button className="btn primary" disabled={!stream} onClick={snap}><Icon n="camera" size={14} />Capture</button></>}>
      {err ? <div className="callout warn"><Icon n="alert" />{err}</div> : <video ref={video} className="cam" playsInline muted />}
      <p className="muted small">Each capture is added to the sample. Keep shooting, then close this window.</p>
    </Modal>
  );
}

// Drop zone + camera buttons. onAdd receives File[]
export function PhotoInput({ onAdd, compact }) {
  const pick = useRef(null);
  const cam = useRef(null);
  const [drag, setDrag] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const takePhoto = () => {
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch) cam.current.click(); else setCamOpen(true);
  };
  return (
    <>
      <div className={cx('photo-drop', drag && 'on', compact && 'compact')} onClick={() => pick.current.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); onAdd([...e.dataTransfer.files]); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick.current.click()}>
        <Icon n="upload" size={18} />
        <div><b>Drop photos here or click to browse</b><div className="muted small">JPG, PNG or HEIC, up to 12 MB each</div></div>
      </div>
      <button type="button" className="btn ghost photo-cam" onClick={takePhoto}><Icon n="camera" size={14} />Take photo with camera</button>
      <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { onAdd([...e.target.files]); e.target.value = ''; }} />
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onAdd([...e.target.files]); e.target.value = ''; }} />
      {camOpen && <CameraModal onClose={() => setCamOpen(false)} onShot={(f) => onAdd([f])} fallback={() => { setCamOpen(false); pick.current.click(); }} />}
    </>
  );
}

export function PhotoGrid({ photos, onRemove, onCaption }) {
  const [open, setOpen] = useState(null);
  if (!photos.length) return null;
  const p = photos.find((x) => x.id === open);
  return (
    <>
      <div className="thumbs">
        {photos.map((ph) => (
          <figure key={ph.id} className="thumb">
            <button type="button" onClick={() => setOpen(ph.id)} aria-label={'Open photo ' + ph.name}><img src={ph.src} alt={ph.caption || ph.name} /></button>
            <figcaption>{ph.caption || ph.stage}<span>{fmtDate(ph.at)}{ph.by ? ' · ' + ph.by : ''}</span></figcaption>
            {onRemove && <button type="button" className="thumb-x" onClick={() => onRemove(ph.id)} aria-label="Remove photo"><Icon n="x" size={12} /></button>}
          </figure>
        ))}
      </div>
      {p && (
        <Modal wide title={p.caption || p.name} sub={`${p.stage} · ${fmtDate(p.at)}${p.by ? ' · ' + p.by : ''}`} onClose={() => setOpen(null)}
          footer={<a className="btn ghost" href={p.src} download={p.name.replace(/\.\w+$/, '') + '.jpg'}><Icon n="download" size={14} />Download</a>}>
          <img className="lightbox" src={p.src} alt={p.caption || p.name} />
          {onCaption && <input placeholder="Caption, e.g. Outer box, tracking label, torn corner" value={p.caption} onChange={(e) => onCaption(p.id, e.target.value)} />}
        </Modal>
      )}
    </>
  );
}
