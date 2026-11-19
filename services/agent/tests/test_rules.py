"""Rules of a turn that need no model or database."""

from __future__ import annotations

import pytest

from hiwar_agent.egress import EgressRefused, _check_host
from hiwar_agent.normalise import search_key
from hiwar_agent.parsing import ParseFailed, extract_html, languages_of
from hiwar_agent.turn import blocked_topic, is_negative, language_of


def test_arabic_is_detected_by_unicode_range() -> None:
    assert language_of("مرحبا") == "ar"
    assert language_of("Where is my order?") == "en"
    assert language_of("order 4821 وين") == "ar"


def test_arabic_letter_forms_fold_for_search() -> None:
    assert search_key("أين طلبي؟") == search_key("اين طلبي؟")
    assert search_key("مكتبة") == search_key("مكتبه")


def test_blocked_topic_matches_in_either_language() -> None:
    assert blocked_topic("What do you think about politics?", "Medical advice, politics") == "politics"
    assert blocked_topic("Do you deliver to Sharjah?", "Medical advice, politics") is None
    assert blocked_topic("ما رأيك في السياسة", "السياسة، الطب") is not None


def test_negative_sentiment_words() -> None:
    assert is_negative("This is unacceptable, I am furious")
    assert is_negative("الخدمة زفت")
    assert not is_negative("Thanks, that helps")


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://10.0.0.5/x", "http://169.254.169.254/latest", "ftp://example.com/"])
async def test_egress_refuses_private_and_non_http(url: str) -> None:
    with pytest.raises(EgressRefused):
        await _check_host(url)


def test_html_text_drops_scripts_and_keeps_links() -> None:
    text, links = extract_html("<html><script>x=1</script><body><p>Delivery is free above AED 60.</p><a href='/menu'>Menu</a></body></html>")
    assert "Delivery is free" in text and "x=1" not in text
    assert links == ["/menu"]


def test_languages_of_mixed_text() -> None:
    assert languages_of("Menu and allergens القائمة والمكونات " * 3) == "English and Arabic"


def test_parse_failed_is_an_exception() -> None:
    assert issubclass(ParseFailed, Exception)
