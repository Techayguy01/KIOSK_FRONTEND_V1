import React from "react"
import { Mic } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { cn } from "../../lib/utils"

interface VoiceInputProps {
  onStart?: () => void
  onStop?: () => void
}

export function VoiceInput({
  className,
  onStart,
  onStop,
}: React.ComponentProps<"div"> & VoiceInputProps) {
  const [_listening, _setListening] = React.useState<boolean>(false)
  const [_time, _setTime] = React.useState<number>(0)

  React.useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined

    if (_listening) {
      onStart?.()
      intervalId = setInterval(() => {
        _setTime((t) => t + 1)
      }, 1000)
    } else {
      onStop?.()
      _setTime(0)
    }

    return () => clearInterval(intervalId)
  }, [_listening])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const onClickHandler = () => {
    _setListening(!_listening)
  }

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <motion.div
        className="flex p-4 border border-slate-700 bg-slate-800 items-center justify-center rounded-full cursor-pointer hover:bg-slate-700 transition-colors"
        layout
        transition={{
          layout: {
            duration: 0.4,
          },
        }}
        onClick={onClickHandler}
      >
        <div className="h-8 w-8 items-center justify-center flex">
          {_listening ? (
            <motion.div
              className="w-4 h-4 bg-red-500 rounded-sm"
              animate={{
                rotate: [0, 180, 360],
              }}
              transition={{
                duration: 2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
          ) : (
            <Mic className="text-white w-6 h-6" />
          )}
        </div>
        <AnimatePresence mode="wait">
          {_listening && (
            <motion.div
              initial={{ opacity: 0, width: 0, marginLeft: 0 }}
              animate={{ opacity: 1, width: "auto", marginLeft: 16 }}
              exit={{ opacity: 0, width: 0, marginLeft: 0 }}
              transition={{
                duration: 0.4,
              }}
              className="overflow-hidden flex gap-4 items-center justify-center"
            >
              {/* Frequency Animation */}
              <div className="flex gap-1 items-center justify-center h-6">
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-red-400 rounded-full"
                    initial={{ height: 4 }}
                    animate={{
                      height: _listening
                        ? [4, 8 + Math.random() * 16, 6 + Math.random() * 8, 4]
                        : 4,
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      delay: i * 0.05,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
              {/* Timer */}
              <div className="text-sm font-mono text-slate-300 w-12 text-center">
                {formatTime(_time)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}