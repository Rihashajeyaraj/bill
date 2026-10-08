import React from "react";
import clsx from "clsx";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

const PAGE_LOADER_SRC =
  "https://lottie.host/3031a55a-6c5d-4755-b5a4-86a0ff7226f3/kbPWxi01Tf.lottie";

export default function PageLoader({ visible }) {
  return (
    <div
      aria-hidden={!visible}
      className={clsx(
        "page-loader-overlay pointer-events-none absolute inset-0 z-40 flex items-center justify-center transition-all duration-300",
        visible ? "visible opacity-100" : "invisible opacity-0"
      )}
    >
      <div className="page-loader-panel flex flex-col items-center justify-center rounded-3xl px-5 py-4 sm:px-6">
        <div className="h-[120px] w-[120px] sm:h-[148px] sm:w-[148px]">
          <DotLottieReact
            src={PAGE_LOADER_SRC}
            autoplay
            loop
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <p className="mt-1 text-center text-xs font-semibold tracking-wide text-emerald-900/80 sm:text-sm">
          Loading workspace...
        </p>
      </div>
    </div>
  );
}
