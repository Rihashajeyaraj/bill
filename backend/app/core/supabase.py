from supabase import create_client, Client
from app.core.config import settings

def get_supabase_client(token: str = None) -> Client:
    """
    Returns a Supabase client instance.
    If a Bearer JWT token is provided, sets auth header for user-authenticated queries.
    """
    url = settings.SUPABASE_URL
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    
    client = create_client(url, key)
    if token:
        client.postgrest.auth(token)
    return client

def get_admin_supabase_client() -> Client:
    """
    Returns an administrative Supabase client using service role key (or fallback anon key).
    """
    url = settings.SUPABASE_URL
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return create_client(url, key)
