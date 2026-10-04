import unittest
from unittest.mock import Mock, call, patch
from urllib.error import HTTPError

from backend import check_site


class SiteStatusTests(unittest.TestCase):
    def test_redirect_counts_as_online_without_following_it(self):
        response = HTTPError("https://example.test", 302, "Found", {}, None)
        with patch("urllib.request.build_opener") as build_opener:
            build_opener.return_value.open.side_effect = response
            result = check_site("https://example.test")

        self.assertEqual(result, {"url": "https://example.test", "status": 302, "online": True})
        build_opener.return_value.open.assert_called_once()

    def test_get_fallback_when_head_is_unsupported(self):
        response = Mock()
        response.__enter__.return_value.status = 200
        with patch("urllib.request.build_opener") as build_opener:
            opener = build_opener.return_value
            opener.open.side_effect = [
                HTTPError("https://example.test", 405, "Method Not Allowed", {}, None),
                response,
            ]
            result = check_site("https://example.test")

        self.assertTrue(result["online"])
        self.assertEqual(result["status"], 200)
        methods = [args[0][0].get_method() for args in opener.open.call_args_list]
        self.assertEqual(methods, ["HEAD", "GET"])


if __name__ == "__main__":
    unittest.main()
