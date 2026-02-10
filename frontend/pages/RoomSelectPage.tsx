import React, { useState, useEffect } from 'react';
import { useUIState } from '../state/uiContext';

// 1. DEFINE THE DATA STRUCTURE 📦
interface Room {
  id: number;
  name: string;
  price: string; // Display price
  image: string;
  description: string;
  features: string[];
}

// 2. HARDCODE THE INVENTORY (The "Demo Data") 🏨
const MOCK_ROOMS: Room[] = [
  {
    id: 101,
    name: "Deluxe Ocean Suite",
    price: "$450",
    image: "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=800&q=80",
    description: "Panoramic ocean views with a king-size bed and private balcony.",
    features: ["King Bed", "Ocean View", "Jacuzzi", "Free WiFi"]
  },
  {
    id: 102,
    name: "Standard King Room",
    price: "$200",
    image: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=800&q=80",
    description: "Comfortable and cozy, perfect for business travelers.",
    features: ["Queen Bed", "Work Desk", "City View", "Coffee Maker"]
  },
  {
    id: 103,
    name: "Family Twin Suite",
    price: "$350",
    image: "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=800&q=80",
    description: "Spacious room with two double beds, ideal for families.",
    features: ["2 Double Beds", "Lounge Area", "Kid Friendly", "Smart TV"]
  }
];

export const RoomSelectPage: React.FC = () => {
  const { emit } = useUIState();

  const onRoomSelected = (room: Room) => {
    emit('ROOM_SELECTED', { room });
  };

  // 3. RENDER THE CARDS 🃏
  return (
    <div className="h-full w-full bg-gray-900 p-8 overflow-y-auto">
      <h1 className="text-4xl text-white font-bold mb-2">Select Your Room</h1>
      <p className="text-gray-400 mb-8">Speak "I want the Deluxe Suite" or tap a card below.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {MOCK_ROOMS.map((room) => (
          <div
            key={room.id}
            onClick={() => onRoomSelected(room)}
            className="bg-gray-800 rounded-2xl overflow-hidden shadow-2xl hover:scale-105 transition-transform duration-300 cursor-pointer border border-gray-700 hover:border-blue-500"
          >
            {/* Image Header */}
            <div className="h-48 bg-gray-700 relative">
              <img
                src={room.image}
                alt={room.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full text-white font-bold">
                {room.price}<span className="text-xs font-normal text-gray-300">/night</span>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-6">
              <h3 className="text-2xl font-bold text-white mb-2">{room.name}</h3>
              <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                {room.description}
              </p>

              {/* Features Tags */}
              <div className="flex flex-wrap gap-2 mb-6">
                {room.features.slice(0, 3).map((f, i) => (
                  <span key={i} className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded-md">
                    {f}
                  </span>
                ))}
              </div>

              {/* Action Button */}
              <button className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors">
                Select Room
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
