import React from 'react';
import { Check, User, Monitor, Wifi, Coffee } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  features: string[];
}

interface RoomCardProps {
  room: Room;
  onSelect: (room: Room) => void;
  selected: boolean;
}

export const RoomCard: React.FC<RoomCardProps> = ({ room, onSelect, selected }) => {
  return (
    <div 
      onClick={() => onSelect(room)}
      className={`group relative overflow-hidden rounded-2xl border-2 cursor-pointer transition-all duration-300 ${
        selected 
          ? 'border-blue-500 bg-slate-800 scale-[1.02] shadow-2xl shadow-blue-500/20' 
          : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
      }`}
    >
      <div className="aspect-video w-full overflow-hidden">
        <img 
          src={room.image} 
          alt={room.name}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        {selected && (
          <div className="absolute top-4 right-4 bg-blue-500 text-white p-2 rounded-full shadow-lg">
            <Check size={20} />
          </div>
        )}
      </div>
      
      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xl font-bold text-white">{room.name}</h3>
          <div className="text-right">
            <span className="block text-lg font-bold text-blue-400">
              {room.currency === 'USD' ? '$' : room.currency}{room.price}
            </span>
            <span className="text-xs text-slate-400">/ night</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {room.features.map((feature, i) => (
            <span key={i} className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded-md flex items-center gap-1">
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};