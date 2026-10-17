"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export default function PwaInstallButton() {
  const [promptEvent, setPromptEvent] =
    useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setIosHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <span className="appInstallStatus" aria-label="App installed">
        APP MODE
      </span>
    );
  }

  async function install() {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
      setPromptEvent(null);
      return;
    }

    if (isIos()) {
      setIosHint((value) => !value);
      return;
    }

    setIosHint(true);
  }

  return (
    <div className="appInstall">
      <button
        className="appInstallButton"
        type="button"
        onClick={() => void install()}
      >
        Install App
      </button>

      {iosHint ? (
        <div className="appInstallHint" role="status">
          {isIos()
            ? "On iPhone/iPad: open in Safari → Share → Add to Home Screen."
            : "Use your browser menu and choose Install app / Add to Home Screen."}
        </div>
      ) : null}
    </div>
  );
}
