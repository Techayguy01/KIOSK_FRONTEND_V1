import React, { useMemo } from 'react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { RoomPreviewStoryCarousel, type RoomPreviewVisual } from '../components/ui/room-preview-story-carousel';
import { ProgressBar } from '../components/ProgressBar';
import { useUIState } from '../state/uiContext';
import type { RoomDTO, RoomImageDTO } from '../services/room.service';

function humanize(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token, index) => {
      const lowered = token.toLowerCase();
      return index === 0 ? lowered.charAt(0).toUpperCase() + lowered.slice(1) : lowered;
    })
    .join(' ');
}

function joinAsSentence(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function buildImageDescription(image: RoomImageDTO): string {
  const tags = Array.isArray(image.tags)
    ? image.tags.map((tag) => humanize(tag)).filter(Boolean)
    : [];
  if (tags.length > 0) return tags.slice(0, 5).join(' | ');
  if (image.caption) return String(image.caption).trim();
  return humanize(image.category) || 'Room preview';
}

function buildPreviewImages(room: RoomDTO | null): RoomPreviewVisual[] {
  if (!room) return [];

  if (Array.isArray(room.images) && room.images.length > 0) {
    return room.images
      .map((image, index) => {
        const src = String(image.url || '').trim();
        if (!src) return null;
        const fallbackTitle = index === 0 ? room.name : `${room.name} ${index + 1}`;
        return {
          id: String(image.id || `${room.id}-${index}`),
          src,
          title: humanize(image.category) || String(image.caption || '').trim() || fallbackTitle,
          description: buildImageDescription(image),
          category: humanize(image.category) || 'Room view',
        } satisfies RoomPreviewVisual;
      })
      .filter((image): image is RoomPreviewVisual => Boolean(image));
  }

  const rawUrls = Array.isArray(room.imageUrls) && room.imageUrls.length > 0
    ? room.imageUrls
    : [room.image];

  return Array.from(new Set(rawUrls.map((url) => String(url || '').trim()).filter(Boolean))).map((src, index) => ({
    id: `${room.id}-${index}`,
    src,
    title: index === 0 ? room.name : `${room.name} ${index + 1}`,
    description: `Preview ${index + 1} of ${room.name}`,
    category: 'Room view',
  }));
}

function resolveSelectedRoom(data: any): RoomDTO | null {
  const selectedRoom = data?.selectedRoom || null;
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  if (selectedRoom?.id) {
    return rooms.find((room: RoomDTO) => room.id === selectedRoom.id) || selectedRoom;
  }

  const selectedLabel = String(
    selectedRoom?.displayName ||
    selectedRoom?.name ||
    data?.bookingSlots?.roomType ||
    ''
  ).trim().toLowerCase();

  if (!selectedLabel) return null;
  return rooms.find((room: RoomDTO) => String(room.name || '').trim().toLowerCase() === selectedLabel) || selectedRoom || null;
}

function buildRoomNarrative(room: RoomDTO | null, images: RoomPreviewVisual[]): string {
  if (!room) return 'Choose a room to begin the preview.';

  const spaces = Array.from(
    new Set(
      images
        .map((image) => String(image.category || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 3);
  const features = Array.isArray(room.features) ? room.features.filter(Boolean).slice(0, 3) : [];

  const pieces = [
    spaces.length > 0 ? `Take a closer look at the ${joinAsSentence(spaces.map((space) => space.toLowerCase()))}` : null,
    features.length > 0 ? `with comforts such as ${joinAsSentence(features)}` : null,
  ].filter(Boolean) as string[];

  if (pieces.length === 0) {
    return `${room.name} is ready to preview. Browse the visuals and continue whenever the guest feels ready.`;
  }

  return `${room.name} is ready to preview. ${pieces.join(', ')}. Continue when the guest feels comfortable with this choice.`;
}

function buildVoicePrompts(room: RoomDTO | null, images: RoomPreviewVisual[]): string[] {
  const prompts = new Set<string>();
  prompts.add(room?.name ? `Tell me about ${room.name}` : 'Tell me about this room');

  images
    .map((image) => String(image.category || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .forEach((category) => {
      prompts.add(`Show me the ${category.toLowerCase()}`);
    });

  prompts.add('Show me another room');
  prompts.add('Open full view');
  prompts.add('Close full view');
  prompts.add('Yes, continue with this room');
  return Array.from(prompts).slice(0, 4);
}

export const RoomPreviewPage: React.FC = () => {
  const { data, emit } = useUIState();
  const room = resolveSelectedRoom(data);
  const visuals = useMemo(() => buildPreviewImages(room), [room]);
  const focusImageId = String(data?.visualFocus?.imageId || '').trim() || null;
  const isGalleryFullscreen = Boolean(data?.isGalleryFullscreen);
  const progress = data?.progress || { currentStep: 2, totalSteps: 4, steps: ['ID Scan', 'Room', 'Payment', 'Key'] };
  const narrative = useMemo(() => buildRoomNarrative(room, visuals), [room, visuals]);
  const voicePrompts = useMemo(() => buildVoicePrompts(room, visuals), [room, visuals]);

  return (
    <div className="relative min-h-screen w-full text-white overflow-x-hidden">
      <AnimatedGradientBackground Breathing={true} />

      <div className="relative z-10 flex h-full min-h-screen w-full flex-col p-6 md:p-8 lg:p-10">
        <ProgressBar
          currentStep={progress.currentStep}
          totalSteps={progress.totalSteps}
          labels={progress.steps}
        />

        <div className="mx-auto flex w-full max-w-7xl flex-1 min-h-0 flex-col">
          <header className="mb-6 max-w-4xl">
            <p className="text-xs uppercase tracking-[0.34em] text-cyan-100/72">Room Preview</p>
            <h1 className="mt-2 md:mt-3 text-3xl md:text-5xl font-light tracking-[-0.05em] text-white leading-tight">
              {room?.name ? `Explore ${room.name}` : 'Explore the room before booking'}
            </h1>
            <p className="mt-3 md:mt-4 max-w-3xl text-sm md:text-base leading-relaxed text-white/68">
              This preview stays voice-first and guest-friendly. Let Siya walk through the real room visuals, comfort details, and spaces before you move into booking.
            </p>
          </header>

          <div className="flex-1 min-h-0">
            <RoomPreviewStoryCarousel
              room={room}
              visuals={visuals}
              narrative={narrative}
              focusImageId={focusImageId}
              isFullscreen={isGalleryFullscreen}
              onFullscreenChange={(isOpen) => emit('TOGGLE_FULLSCREEN_GALLERY', { isOpen })}
              voicePrompts={voicePrompts}
              onConfirm={() => emit('CONFIRM_BOOKING')}
              onBack={() => emit('BACK_REQUESTED')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
