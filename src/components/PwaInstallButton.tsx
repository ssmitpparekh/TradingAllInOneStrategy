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
  const [hint, setHint] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };

    const installedHandler = () => {
      setInstalled(true);
      setPromptEvent(null);
      setHint(false);
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (installed) {
    return <span className="appInstallStatus">APP MODE</span>;
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

    setHint((value) => !value);
  }

  return (
    <div className="appInstall">
      <button
        type="button"
        className="appInstallButton"
        onClick={() => void install()}
      >
        Install App
      </button>

      {hint ? (
        <div className="appInstallHint" role="status">
          {isIos()
            ? "iPhone/iPad: open in Safari → Share → Add to Home Screen."
            : "Android/Desktop: use the browser Install app / Add to Home Screen option. Install prompts require HTTPS production hosting."}
        </div>
      ) : null}
    </div>
  );
}
