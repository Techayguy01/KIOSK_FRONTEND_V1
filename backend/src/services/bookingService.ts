// backend/src/services/bookingService.ts
import { prisma } from '../db';
import Stripe from 'stripe';

// Initialize Stripe (Use a test key or env variable)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    // @ts-ignore - Stripe versioning can be tricky in TS
    apiVersion: '2022-11-15',
});

export const bookingService = {

    // 1. Create a Pending Booking
    async createPendingBooking(roomId: string, guestEmail: string) {
        // Find the guest or create a placeholder
        let guest = await prisma.guest.findUnique({ where: { email: guestEmail } });
        if (!guest) {
            guest = await prisma.guest.create({
                data: {
                    email: guestEmail,
                    firstName: "Guest",
                    lastName: "Unknown"
                }
            });
        }

        // Check if room is free
        const room = await prisma.room.findUnique({ where: { id: roomId } });
        if (!room || room.status !== 'AVAILABLE') {
            throw new Error("Room is not available.");
        }

        // Create the booking record
        const booking = await prisma.booking.create({
            data: {
                roomId,
                guestId: guest.id,
                checkIn: new Date(),
                checkOut: new Date(Date.now() + 86400000), // 1 day default
                status: 'PENDING'
            }
        });

        return booking;
    },

    // 2. Generate Payment Link (Simple checkout)
    async createPaymentSession(bookingId: string, amount: number) {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Hotel Room Booking' },
                    unit_amount: Math.round(amount * 100), // Cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `http://localhost:3000/success?booking=${bookingId}`,
            cancel_url: `http://localhost:3000/cancel`,
        });

        return session.url;
    }
};
