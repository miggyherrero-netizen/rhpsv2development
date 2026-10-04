import { listAds, loadGosSettings } from "@/server/gos/settings";
import SettingsClient from "@/components/gos/settings-client";

export default async function SettingsPage() {
  const [settings, ads] = await Promise.all([loadGosSettings(), listAds()]);
  if (!settings.ok) return <p role="alert" className="gos-card mt-4">{settings.error}</p>;
  if (!ads.ok) return <p role="alert" className="gos-card mt-4">{ads.error}</p>;
  return <SettingsClient initial={settings.value} initialAds={ads.value} />;
}
