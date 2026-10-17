import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { billingApi } from "../api.js";

const OutboundGateContext = createContext({
  blocked: false,
  message: "",
  reason: null,
  refresh: () => {},
});

export function OutboundGateProvider({ enabled, children }) {
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState(null);

  const refresh = () => {
    if (!enabled) {
      setBlocked(false);
      setMessage("");
      setReason(null);
      return;
    }
    billingApi
      .getStatus()
      .then((b) => {
        const isBlocked = !!b?.outboundBlocked;
        setBlocked(isBlocked);
        setReason(b?.outboundBlockReason || null);
        setMessage(
          b?.outboundBlockMessage ||
            (isBlocked
              ? "Outbound calling, SMS, and email are locked until billing is active."
              : "")
        );
      })
      .catch(() => {
        setBlocked(false);
        setMessage("");
        setReason(null);
      });
  };

  useEffect(() => {
    refresh();
  }, [enabled]);

  const value = useMemo(
    () => ({ blocked, message, reason, refresh }),
    [blocked, message, reason]
  );

  return (
    <OutboundGateContext.Provider value={value}>{children}</OutboundGateContext.Provider>
  );
}

export function useOutboundGate() {
  return useContext(OutboundGateContext);
}
