import os
import bcrypt
import jwt
from datetime import datetime, timezone
from fastapi import HTTPException, Depends, Header, Request
from typing import Annotated, Optional

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    if os.environ.get('ENVIRONMENT') == 'production' or os.environ.get('RAILWAY_ENVIRONMENT'):
        raise ValueError("CRITICAL: JWT_SECRET environment variable is missing. It must be explicitly set in production environments.")
    JWT_SECRET = 'dev-secret-change-in-production'
JWT_ALGORITHM = 'HS256'

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, name: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'name': name,
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

CurrentUser = Annotated[dict, Depends(get_current_user)]
