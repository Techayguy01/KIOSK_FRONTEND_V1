import React from 'react';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ currentStep, totalSteps, labels }) => {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="w-full max-w-3xl mx-auto mb-10">
      <div className="flex justify-between mb-3">
        {labels?.map((label, index) => (
          <span 
            key={index} 
            className={`text-sm font-semibold uppercase tracking-widest ${
              index + 1 <= currentStep ? 'text-blue-300' : 'text-slate-500'
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
        <div 
          className="h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};
