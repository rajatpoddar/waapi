"""Pydantic request/response models for the REST API."""
from typing import Annotated

from pydantic import BaseModel, Field

SESSION_PATTERN = r"^[a-zA-Z0-9_-]+$"


class SendTextRequest(BaseModel):
    session: str = Field(default="default", min_length=1, max_length=64, pattern=SESSION_PATTERN)
    number: str = Field(min_length=5, max_length=32)
    message: str = Field(min_length=1, max_length=4096)


class SendContactRequest(BaseModel):
    session: str = Field(default="default", min_length=1, max_length=64, pattern=SESSION_PATTERN)
    number: str = Field(min_length=5, max_length=32)
    name: str = Field(min_length=1, max_length=256)
    phone: str = Field(min_length=5, max_length=32)


class SendLocationRequest(BaseModel):
    session: str = Field(default="default", min_length=1, max_length=64, pattern=SESSION_PATTERN)
    number: str = Field(min_length=5, max_length=32)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    name: str | None = Field(default=None, max_length=256)
    address: str | None = Field(default=None, max_length=512)


class ContactsCheckRequest(BaseModel):
    session: str = Field(default="default", min_length=1, max_length=64, pattern=SESSION_PATTERN)
    numbers: list[Annotated[str, Field(min_length=5, max_length=32)]] = Field(min_length=1, max_length=50)


class LogoutRequest(BaseModel):
    session: str = Field(default="default", min_length=1, max_length=64, pattern=SESSION_PATTERN)


class SendResponse(BaseModel):
    success: bool = True
    session: str
    number: str
    messageId: str
    timestamp: str
    status: str


class MediaSendResponse(SendResponse):
    filePath: str | None = None
