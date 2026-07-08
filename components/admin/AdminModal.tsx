'use client';

import { useEffect, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

// ---------------------------------------------------------------------------
// Size map
// ---------------------------------------------------------------------------

const sizeClasses: Record<NonNullable<AdminModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', damping: 25, stiffness: 350 },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: AdminModalProps) {
  // ---- Escape key handler ----
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('keydown', handleEscape);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = prev;
    };
  }, [isOpen, handleEscape]);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* ---- Backdrop ---- */}
          <motion.div
            className="absolute inset-0 bg-[#0c0c0c]/50 backdrop-blur-sm"
            variants={backdropVariants}
            onClick={onClose}
            aria-hidden
          />

          {/* ---- Modal Panel ---- */}
          <motion.div
            className={`
              relative z-10 w-full ${sizeClasses[size]}
              rounded-2xl border border-[#E2E8F0] bg-white
              shadow-2xl
            `}
            variants={modalVariants}
            role="dialog"
            aria-modal
            aria-labelledby="admin-modal-title"
          >
            {/* ---- Header ---- */}
            <div className="flex items-start justify-between border-b border-[#E2E8F0] px-6 py-5">
              <div>
                <h2
                  id="admin-modal-title"
                  className="text-lg font-semibold text-[#0c0c0c]"
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-1 text-sm text-[#6c6a68]">{description}</p>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="
                  -mr-1 -mt-1 rounded-lg p-1.5
                  text-[#6c6a68] transition-colors
                  hover:bg-[#f1eade] hover:text-[#0c0c0c]
                  focus-visible:outline-none focus-visible:ring-2
                  focus-visible:ring-[#cbfb45]
                "
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* ---- Body ---- */}
            <div className="px-6 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
