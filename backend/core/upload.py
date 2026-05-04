import os
import aiofiles
from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
_CHUNK_SIZE = 1024 * 1024  # 1 MB

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
}

ALLOWED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
}


def _validate_content_type(file: UploadFile) -> None:
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")


def _validate_extension(file: UploadFile) -> None:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file extension")


def _validate_declared_size(file: UploadFile) -> None:
    if file.size and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large ({MAX_UPLOAD_BYTES} bytes max)")


async def stream_upload_to_disk(file: UploadFile, file_path: str) -> None:
    """Stream an uploaded file to disk in chunks with size and type validation."""
    _validate_content_type(file)
    _validate_extension(file)
    _validate_declared_size(file)

    size = 0
    try:
        async with aiofiles.open(file_path, "wb") as out:
            while chunk := await file.read(_CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File too large ({MAX_UPLOAD_BYTES} bytes max)")
                await out.write(chunk)
    except HTTPException:
        # Clean up partial file on validation failure
        if os.path.exists(file_path):
            os.remove(file_path)
        raise


async def stream_upload_to_bytes(file: UploadFile) -> bytes:
    """Read an uploaded file into memory with size and type validation.

    Use for small payloads that must be parsed in memory (e.g. CSV import).
    Enforces the same ``MAX_UPLOAD_BYTES`` / ``ALLOWED_CONTENT_TYPES`` limits
    as ``stream_upload_to_disk`` so there is no unbounded-read DoS surface.
    """
    _validate_content_type(file)
    _validate_extension(file)
    _validate_declared_size(file)

    size = 0
    chunks: list[bytes] = []
    while chunk := await file.read(_CHUNK_SIZE):
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"File too large ({MAX_UPLOAD_BYTES} bytes max)")
        chunks.append(chunk)
    return b"".join(chunks)
