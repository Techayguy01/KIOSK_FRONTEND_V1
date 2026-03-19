import React from "react";
import { Mail, MapPin, PhoneCall } from "lucide-react";
import { BackButton } from "../components/BackButton";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";
import { useUIState } from "../state/uiContext";

type HelpItemProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
};

const HelpItem: React.FC<HelpItemProps> = ({ icon, label, value }) => (
  <div className="w-full rounded-3xl border border-white/15 bg-slate-900/70 p-6 md:p-8 backdrop-blur-md">
    <div className="mb-3 flex items-center gap-3 text-cyan-200">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/15">
        {icon}
      </span>
      <p className="text-sm md:text-base uppercase tracking-[0.14em] text-white/70">{label}</p>
    </div>
    <p className="break-words text-2xl md:text-3xl font-medium text-white">{value}</p>
  </div>
);

export const HelpPage: React.FC = () => {
  const { tenant } = useUIState();
  const supportPhone =
    tenant?.hotelConfig?.support_phone ||
    tenant?.hotelConfig?.supportPhone ||
    tenant?.support_phone ||
    null;
  const supportEmail =
    tenant?.hotelConfig?.support_email ||
    tenant?.hotelConfig?.supportEmail ||
    tenant?.support_email ||
    null;
  const address = tenant?.hotelConfig?.address || tenant?.address || null;
  const hasDetails = Boolean(supportPhone || supportEmail || address);

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden text-white">
      <AnimatedGradientBackground Breathing={true} />
      <BackButton />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-16 md:px-12">
        <div className="mb-10 md:mb-12 text-center">
          <h1 className="text-4xl md:text-6xl font-light tracking-[-0.03em]">Help & Support</h1>
          <p className="mt-4 text-lg md:text-2xl text-slate-200">Our team is ready to assist you.</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:gap-6">
          {supportPhone && (
            <HelpItem icon={<PhoneCall size={20} />} label="Support Phone" value={supportPhone} />
          )}
          {supportEmail && (
            <HelpItem icon={<Mail size={20} />} label="Support Email" value={supportEmail} />
          )}
          {address && (
            <HelpItem icon={<MapPin size={20} />} label="Address" value={address} />
          )}
          {!hasDetails && (
            <div className="rounded-3xl border border-amber-300/30 bg-amber-500/10 p-6 md:p-8 text-center">
              <p className="text-xl md:text-2xl text-amber-100">
                Support details are unavailable right now. Please approach the front desk for assistance.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
