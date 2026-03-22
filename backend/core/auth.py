import os
import secrets
import logging
import bcrypt
import jwt
from datetime import datetime, timezone
from fastapi import HTTPException, Depends, Header, Request
from typing import Annotated, Optional

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    if os.environ.get('ENVIRONMENT') == 'production' or os.environ.get('RAILWAY_ENVIRONMENT'):
        raise ValueError("CRITICAL: JWT_SECRET environment variable is missing. It must be explicitly set in production environments.")
    JWT_SECRET = secrets.token_urlsafe(32)
    logging.warning("JWT_SECRET environment variable is missing. Using a randomly generated secret. All user sessions will be invalidated when the server restarts. Do not use this configuration in production.")
JWT_ALGORITHM = 'HS256'

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, name: str, role: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'name': name,
        'role': role,
        'exp': datetime.now(timezone.utc).timestamp() + 86400 * 7
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def get_current_user(request: Request, authorization: Annotated[Optional[str], Header()] = None):
    token = request.cookies.get('auth_token')
    if not token and authorization and authorization.startswith('Bearer '):
        token = authorization.split(' ')[1]
        
    if not token:
        raise HTTPException(status_code=401, detail='Not authenticated')
        
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')

from typing import Annotated, Optional, List
from fastapi import Depends

CurrentUser = Annotated[dict, Depends(get_current_user)]

class RoleRequired:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, user: CurrentUser):
        if user.get("role") not in self.allowed_roles:
            raise HTTPException(
                status_code=403, 
                detail=f"Operation not permitted. Required roles: {', '.join(self.allowed_roles)}"
            )
        return user

AdminRequired = Annotated[dict, Depends(RoleRequired(["admin"]))]
SchedulerRequired = Annotated[dict, Depends(RoleRequired(["admin", "scheduler"]))]
