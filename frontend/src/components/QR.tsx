'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Button } from './ui';

export function QR({ value, size = 220, name = 'qr' }: { value: string; size?: number; name?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: '#07070a', light: '#ffffff' }, errorCorrectionLevel: 'M' }).then(setUrl); }, [value, size]);
  if (!url) return <div className="skeleton rounded-2xl" style={{ width: size, height: size }} />;
  return (
    <div className="inline-block text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="QR code" width={size} height={size} className="rounded-2xl bg-white p-2" />
      <a href={url} download={`${name}.png`} className="mt-2 inline-block text-xs text-gold-400 underline">Download QR</a>
    </div>
  );
}

/** Camera scanner. Decoded text is untrusted: the caller sends it to the server, which validates it. */
export function Scanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'denied' | 'unsupported'>('idle');
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);

  const stop = () => { cancelAnimationFrame(raf.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stop, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unsupported');
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch { return setState('denied'); }
    const v = video.current!;
    v.srcObject = stream.current; v.setAttribute('playsinline', 'true');
    await v.play();
    setState('live');
    const c = document.createElement('canvas'); const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const tick = () => {
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0);
        const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) { stop(); setState('idle'); onResult(code.data); return; }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-ink-600 bg-black">
        <video ref={video} muted className="h-full w-full object-cover" />
        {state === 'live' && <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-gold-400/80 shadow-glow" />}
        {state !== 'live' && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-zinc-400">
          {state === 'denied' ? 'Camera permission was denied. Allow camera access in your browser settings, or paste the code below.' : state === 'unsupported' ? 'Camera is not available on this device. Paste the code below.' : 'Tap the button to start the camera.'}
        </div>}
      </div>
      {state !== 'live' ? <Button className="w-full" onClick={start} loading={state === 'starting'}>Start scanning</Button> : <Button variant="ghost" className="w-full" onClick={() => { stop(); setState('idle'); }}>Stop</Button>}
    </div>
  );
}
