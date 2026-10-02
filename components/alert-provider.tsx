"use client";

import { useSyncExternalStore } from "react";
import DebugAlert from "@/components/debug-alert";
import {
  dismissAlert,
  getAlerts,
  subscribeToAlerts,
} from "@/lib/alerts";

const EMPTY_ALERTS: ReturnType<typeof getAlerts> = [];

export default function AlertProvider() {
  const alerts = useSyncExternalStore(
    subscribeToAlerts,
    getAlerts,
    () => EMPTY_ALERTS,
  );

  return (
    <div className="alert-provider" aria-live="polite">
      {alerts.map((alert) => (
        <div className="alert-provider__item" key={alert.id}>
          <DebugAlert title={alert.title} tone={alert.tone}>
            {alert.message}
          </DebugAlert>
          <button
            className="alert-provider__dismiss"
            type="button"
            aria-label={`Dismiss ${alert.title}`}
            onClick={() => dismissAlert(alert.id)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}