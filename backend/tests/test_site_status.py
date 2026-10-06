import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import backend
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
        response = MagicMock()
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

    def test_transport_failure_is_unknown_not_offline(self):
        with patch("urllib.request.build_opener") as build_opener:
            build_opener.return_value.open.side_effect = OSError("timed out")
            result = check_site("https://example.test")

        self.assertEqual(result["status"], 0)
        self.assertIsNone(result["online"])
        self.assertEqual(build_opener.return_value.open.call_count, 2)

    def test_unknown_status_sorts_without_comparing_none(self):
        backend.SITE_CACHE.update(data=None, ts=0)
        sites = ["offline", "unknown", "online"]
        results = {
            "offline": {"url": "offline", "status": 503, "online": False},
            "unknown": {"url": "unknown", "status": 0, "online": None},
            "online": {"url": "online", "status": 200, "online": True},
        }
        with patch("backend.get_sites_list", return_value=sites), \
             patch("backend.check_site", side_effect=lambda url: results[url]), \
             patch("backend.get_widget_config_dict", return_value={"alertOfflineEnabled": False}), \
             patch.object(backend.alert_service, "_delete"):
            result = backend.get_site_status()

        self.assertEqual([site["url"] for site in result["sites"]], ["offline", "online", "unknown"])
        self.assertEqual(result["alerts"], [])


if __name__ == "__main__":
    unittest.main()
