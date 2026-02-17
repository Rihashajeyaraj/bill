import { useEffect, useRef } from "react";
import { beginPageLoading, endPageLoading } from "../state/pageLoadingStore";

export function useGlobalLoadingBridge(active, scope = "page") {
  const tokenRef = useRef(null);

  useEffect(() => {
    if (active && !tokenRef.current) {
      tokenRef.current = beginPageLoading(scope);
      return;
    }

    if (!active && tokenRef.current) {
      endPageLoading(tokenRef.current);
      tokenRef.current = null;
    }
  }, [active, scope]);

  useEffect(
    () => () => {
      if (!tokenRef.current) return;
      endPageLoading(tokenRef.current);
      tokenRef.current = null;
    },
    []
  );
}
