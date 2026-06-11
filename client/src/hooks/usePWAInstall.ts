import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isIOSSafari() {
  return isIOSDevice() && /safari/i.test(navigator.userAgent) && !/crios|fxios|opios|mercury/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export function usePWAInstall() {
  const [androidPrompt, setAndroidPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled]         = useState(isStandalone);

  const ios      = isIOSSafari();
  const showIOS  = ios && !installed;
  const showAndroid = !!androidPrompt && !installed;

  useEffect(() => {
    if (installed) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setAndroidPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setInstalled(true); setAndroidPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [installed]);

  async function installAndroid() {
    if (!androidPrompt) return;
    await androidPrompt.prompt();
    const { outcome } = await androidPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setAndroidPrompt(null);
  }

  return {
    showIOS,
    showAndroid,
    installAndroid,
  };
}
