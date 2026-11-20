from hiwar_agent.config import Settings


def test_database_url_drops_node_postgres_flag() -> None:
    url = "postgresql://hiwar:pw@hiwar-pg-pooler.hiwar-data.svc.cluster.local:5432/hiwar?uselibpqcompat=true&sslmode=prefer"
    assert Settings(database_url=url).database_url == "postgresql://hiwar:pw@hiwar-pg-pooler.hiwar-data.svc.cluster.local:5432/hiwar?sslmode=prefer"


def test_database_url_without_flag_is_unchanged() -> None:
    url = "postgresql://hiwar:hiwar@localhost:5433/hiwar"
    assert Settings(database_url=url).database_url == url
