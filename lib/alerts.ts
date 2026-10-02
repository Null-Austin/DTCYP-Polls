export type AlertTone = "info" | "success" | "warning" | "error";

export type AlertInput = {
  title: string;
  message: string;
  tone?: AlertTone;
  duration?: number;
};

export type Alert = AlertInput & {
  id: number;
};

type AlertListener = () => void;

let alerts: Alert[] = [];
const listeners = new Set<AlertListener>();
let nextAlertId = 1;

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function subscribeToAlerts(listener: AlertListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAlerts() {
  return alerts;
}

export function showAlert(input: AlertInput) {
  const alert = { ...input, id: nextAlertId++ };
  alerts = [...alerts, alert];
  notifyListeners();

  if (input.duration !== 0) {
    globalThis.setTimeout(() => dismissAlert(alert.id), input.duration ?? 5000);
  }

  return alert.id;
}

export function dismissAlert(id: number) {
  const index = alerts.findIndex((alert) => alert.id === id);
  if (index === -1) {
    return;
  }

  alerts = alerts.filter((alert) => alert.id !== id);
  notifyListeners();
}