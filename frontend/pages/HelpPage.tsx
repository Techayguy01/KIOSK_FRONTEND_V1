import React, { useEffect, useState } from "react";
import { ChevronDown, Mail, MapPin, PhoneCall } from "lucide-react";
import { BackButton } from "../components/BackButton";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";
import { FaqItem, getTenantFaqs } from "../services/faq.service";
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
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loadingFaqs, setLoadingFaqs] = useState(false);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null);
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
  const tenantId = String(tenant?.id || "").trim();
  const tenantSlug = String(tenant?.slug || "").trim();

  useEffect(() => {
    let active = true;
    if (!tenantId && !tenantSlug) {
      setFaqs([]);
      setFaqError(null);
      setExpandedFaqId(null);
      return;
    }

    setLoadingFaqs(true);
    setFaqError(null);
    getTenantFaqs(tenantId, tenantSlug)
      .then((rows) => {
        if (!active) return;
        setFaqs(rows);
        setExpandedFaqId((current) => (rows.some((faq) => faq.id === current) ? current : null));
      })
      .catch((error) => {
        console.warn("[HelpPage] Failed to load tenant FAQs", error);
        if (!active) return;
        setFaqs([]);
        setFaqError("Unable to load FAQs right now.");
        setExpandedFaqId(null);
      })
      .finally(() => {
        if (!active) return;
        setLoadingFaqs(false);
      });

    return () => {
      active = false;
    };
  }, [tenantId, tenantSlug]);

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

        {loadingFaqs && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-slate-900/50 px-6 py-5 text-base md:text-lg text-slate-200">
            Loading FAQs...
          </div>
        )}

        {!loadingFaqs && faqError && (
          <div className="mt-8 rounded-3xl border border-amber-300/30 bg-amber-500/10 px-6 py-5 text-base md:text-lg text-amber-100">
            {faqError}
          </div>
        )}

        {!loadingFaqs && !faqError && (tenantId || tenantSlug) && faqs.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-slate-900/50 px-6 py-5 text-base md:text-lg text-slate-200">
            No FAQs are currently published for this hotel.
          </div>
        )}

        {!loadingFaqs && faqs.length > 0 && (
          <section className="mt-8 md:mt-10">
            <h2 className="mb-4 text-2xl md:text-3xl font-light text-white">Frequently Asked Questions</h2>
            <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
              {faqs.map((faq) => {
                const isExpanded = expandedFaqId === faq.id;
                return (
                  <div
                    key={faq.id}
                    className="rounded-2xl border border-white/15 bg-slate-900/65 backdrop-blur-md"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedFaqId(isExpanded ? null : faq.id)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-4 text-left text-lg text-white md:text-xl"
                      aria-expanded={isExpanded}
                    >
                      <span className="font-medium">{faq.question}</span>
                      <ChevronDown
                        size={20}
                        className={`shrink-0 text-cyan-200 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    <div
                      className={`overflow-hidden transition-all duration-300 ease-out ${
                        isExpanded ? "max-h-72 opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      <div className="border-t border-white/10 px-4 py-4 text-base leading-relaxed text-slate-200 md:text-lg">
                        {faq.answer}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
