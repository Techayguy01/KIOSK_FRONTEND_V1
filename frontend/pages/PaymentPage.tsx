import React from 'react';
import { useUIState } from '../state/uiContext';
import { ProgressBar } from '../components/ProgressBar';
import { CreditCard, Lock, Wifi, Loader2 } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { optimizeCloudinaryUrl } from '../lib/cloudinary';

export const PaymentPage: React.FC = () => {
  const { data, emit, loading, tenant } = useUIState();
  const bookingSlots = data.bookingSlots || {};
  const selectedRoom = data.selectedRoom || {};
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const room = rooms.find((candidate: any) => {
    const selectedId = String(selectedRoom?.id || '').trim();
    return selectedId && String(candidate?.id || '').trim() === selectedId;
  }) || rooms.find((candidate: any) => {
    const selectedName = String(selectedRoom?.displayName || selectedRoom?.name || bookingSlots.roomType || '').trim().toLowerCase();
    return selectedName && String(candidate?.name || '').trim().toLowerCase() === selectedName;
  }) || selectedRoom || {};
  const bill = data.bill || { nights: 0, subtotal: '0.00', taxes: '0.00', total: '0.00', currencySymbol: '$' };
  const progress = data.progress || { currentStep: 3, totalSteps: 4, steps: ['Payment'] };
  const roomName = room.name || room.displayName || bookingSlots.roomType || 'Selected room';
  const adults = Number(bookingSlots.adults || 0);
  const children = Number(bookingSlots.children || 0);
  const totalGuests = adults + children;
  const guestLabel = totalGuests > 0
    ? `${totalGuests} Guest${totalGuests === 1 ? '' : 's'}`
    : 'Guests to be confirmed';
  const roomImageRecords = Array.isArray(room.images) ? room.images : [];
  const primaryRoomImage = roomImageRecords.find((image: any) => image?.isPrimary && String(image?.url || '').trim());
  const roomImageUrls = [
    primaryRoomImage?.url,
    ...roomImageRecords.map((image: any) => image?.url),
    ...(Array.isArray(room.imageUrls) ? room.imageUrls : []),
    room.image,
    tenant?.hotelConfig?.logoUrl,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const roomImageSrc = roomImageUrls[0] || '';
  const optimizedRoomImage = optimizeCloudinaryUrl(roomImageSrc);

  const handlePayment = () => {
    emit('CONFIRM_PAYMENT');
  };

  return (
    <div className="h-screen w-full overflow-hidden relative">
       <AnimatedGradientBackground Breathing={true} />
       <div className="relative z-10 h-full w-full flex flex-col p-8">
         <ProgressBar 
          currentStep={progress.currentStep} 
          totalSteps={progress.totalSteps} 
          labels={progress.steps} 
         />

         <div className="flex-1 flex items-center justify-center gap-12 max-w-5xl mx-auto w-full">
         
         {/* Summary Card */}
         <div className="flex-1 bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-2xl">
            <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-6">Reservation Summary</h3>
            
            <div className="flex items-start gap-4 mb-6">
              {roomImageSrc ? (
                <img
                  src={optimizedRoomImage}
                  alt={roomName}
                  className="w-24 h-24 rounded-lg object-cover bg-slate-700/60"
                  onError={(event) => {
                    const target = event.currentTarget;
                    if (target.src !== roomImageSrc) {
                      target.src = roomImageSrc;
                      return;
                    }
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-24 h-24 rounded-lg bg-slate-700/60 flex items-center justify-center text-[11px] text-slate-300 text-center px-2">
                  No hotel image
                </div>
              )}
              <div>
                <h4 className="text-white font-bold text-xl">{roomName}</h4>
                <p className="text-slate-400 text-sm">{bill.nights} Nights | {guestLabel}</p>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-700 pt-6">
              <div className="flex justify-between text-slate-300">
                <span>Room Rate ({bill.nights} nights)</span>
                <span>{bill.currencySymbol}{bill.subtotal}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Taxes & Fees</span>
                <span>{bill.currencySymbol}{bill.taxes}</span>
              </div>
              <div className="flex justify-between text-white font-bold text-xl pt-4 border-t border-slate-700">
                <span>Total</span>
                <span>{bill.currencySymbol}{bill.total}</span>
              </div>
            </div>
         </div>

         {/* Payment Terminal Visual */}
         <div className="flex-1 flex flex-col items-center">
            <div className="w-72 h-96 bg-gradient-to-b from-slate-700 to-slate-800 rounded-3xl p-6 shadow-2xl border-t border-slate-600 relative overflow-hidden flex flex-col items-center justify-between">
               {loading && (
                 <div className="absolute inset-0 z-20 bg-slate-900/90 flex flex-col items-center justify-center text-center p-4">
                   <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                   <p className="text-white font-mono text-sm">AUTHORIZING...</p>
                 </div>
               )}
               
               <div className="w-full text-center border-b border-slate-600 pb-4">
                 <Wifi className="mx-auto text-slate-400 mb-2" size={20} />
                 <p className="text-white font-mono">Insert Card</p>
               </div>

               <CreditCard size={64} className="text-blue-400 animate-bounce" />

               <div className="w-full text-center">
                 <div className="flex gap-2 justify-center mb-4">
                   <div className="w-3 h-3 rounded-full bg-green-400"></div>
                   <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                   <div className="w-3 h-3 rounded-full bg-red-400"></div>
                 </div>
                 <p className="text-xs text-slate-500 flex items-center justify-center gap-1">
                   <Lock size={10} /> Secure Transaction
                 </p>
               </div>
            </div>
            
            <button 
              onClick={handlePayment}
              disabled={loading}
              className="mt-8 px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-full font-medium transition-colors shadow-lg shadow-blue-500/25 flex items-center gap-2"
            >
              {loading ? 'Processing...' : 'Simulate Card Insert'}
            </button>
         </div>
         </div>
       </div>
    </div>
  );
};
