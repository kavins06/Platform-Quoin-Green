"use client";

import { motion, type Variants } from "framer-motion";

interface KPIItem {
  label: string;
  value: string | number;
  subtitle?: string;
  subtitleColor?: "default" | "danger";
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

export function KPIRow({ items }: { items: KPIItem[] }) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {items.map((item, index) => (
        <motion.div
          key={item.label}
          variants={itemVariants}
          className="flex min-h-[176px] flex-col justify-between rounded-[26px] px-6 py-5"
          style={{
            background:
              index === 0
                ? "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,246,241,0.92) 100%)"
                : "rgba(255,255,255,0.82)",
            border: "1px solid rgba(205, 210, 214, 0.72)",
            boxShadow: "0 18px 40px -34px rgba(27, 39, 51, 0.28)",
          }}
        >
          <div className="space-y-5">
            <p
              className="font-dashboard-sans text-[0.88rem] font-medium tracking-[0.01em]"
              style={{ color: "#717983" }}
            >
              {item.label}
            </p>
            <p
              className="font-dashboard-display text-[clamp(2.3rem,4vw,3rem)] font-medium leading-none tracking-[-0.05em]"
              style={{ color: "#20262d" }}
            >
              {item.value}
            </p>
          </div>

          {item.subtitle ? (
            <p
              className="font-dashboard-sans pt-4 text-[0.94rem] leading-6"
              style={{
                color: item.subtitleColor === "danger" ? "#8d514c" : "#626b75",
              }}
            >
              {item.subtitle}
            </p>
          ) : null}
        </motion.div>
      ))}
    </motion.div>
  );
}
