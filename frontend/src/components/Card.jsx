import React from "react";
import clsx from "clsx";

export default function Card({ className, padding = "", children = null, ...props }) {
  return <div className={clsx("card", padding, className)} {...props}>{children}</div>;
}
