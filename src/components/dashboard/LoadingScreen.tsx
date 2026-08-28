"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";

const LoadingScreen = ({ message }: { message?: string }) => {
  return (
    <div className="fresh-loading-container">
      <div className="visual-core">
        <motion.div
          className="logo-pulse-container"
          animate={{
            scale: [1, 1.1, 1],
            filter: [
              "drop-shadow(0 0 15px rgba(249, 115, 22, 0.1))",
              "drop-shadow(0 0 30px rgba(249, 115, 22, 0.4))",
              "drop-shadow(0 0 15px rgba(249, 115, 22, 0.1))",
            ],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Image
            src="/logo-icon.svg"
            alt="Loading MSR Insight..."
            width={80}
            height={80}
            style={{ width: "80px", height: "auto", objectFit: "contain" }}
            priority
          />
        </motion.div>
      </div>
      {message && <p className="fresh-loading-message">{message}</p>}
    </div>
  );
};

export default LoadingScreen;
