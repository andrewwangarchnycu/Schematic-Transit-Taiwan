import { getPushVapidKey, pushWatch, pushUnwatch } from "../api/client.js";

// PushManager.subscribe wants the VAPID public key as a raw Uint8Array, but
// the Worker hands it out URL-safe base64 (the standard wire format for it).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function getOrCreateSubscription() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await getPushVapidKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  return sub;
}

// watch: { city, stopId, routeId, direction, label, thresholdMinutes }
export async function enableArrivalNotification(watch) {
  if (!isPushSupported()) {
    throw new Error("Push notifications aren't supported on this device/browser");
  }
  // Request permission first, as the very first await in this call chain,
  // so it's still counted as triggered by the click that called this.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was denied");
  }
  const sub = await getOrCreateSubscription();
  const { watches } = await pushWatch(sub.toJSON(), watch);
  return watches;
}

export async function disableArrivalNotification(watchId) {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await pushUnwatch(sub.toJSON().endpoint, watchId);
}
