import pytest


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True, scope="session")
def setup_test_db():
    """Ensure SQLite tables exist before any test that touches the DB."""
    from database import create_db_and_tables
    create_db_and_tables()
