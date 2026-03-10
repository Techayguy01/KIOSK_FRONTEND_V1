from sqlmodel import SQLModel

# Import all models here to ensure they are registered with SQLModel's metadata
from .tenant import Tenant
from .room import RoomType
from .booking import Booking
from .faq import FAQ
