import unittest
from unittest.mock import MagicMock, patch

import backend


class ParsecSavingsEndpointTests(unittest.TestCase):
    def setUp(self):
        backend._parsec_savings_cache.update(at=0.0, data=None)

    def test_returns_cli_stdout_unchanged_and_caches_it(self):
        result = MagicMock(returncode=0, stdout="report\n")
        with patch.object(backend, "PARSEC_SAVINGS_BIN", "/fake/parsec"), \
                patch.object(backend.subprocess, "run", return_value=result) as run:
            payload = backend.parsec_savings()
            cached = backend.parsec_savings()

        self.assertEqual(payload["output"], "report\n")
        self.assertTrue(payload["generated_at"])
        self.assertEqual(cached, payload)
        run.assert_called_once_with(
            ["/fake/parsec", "savings"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def test_returns_generic_error_for_nonzero_exit(self):
        result = MagicMock(returncode=2, stdout="partial output")
        with patch.object(backend, "PARSEC_SAVINGS_BIN", "/fake/parsec"), \
                patch.object(backend.subprocess, "run", return_value=result):
            self.assertEqual(backend.parsec_savings(), {"error": "parsec_savings_failed"})

    def test_returns_generic_error_when_binary_is_missing(self):
        with patch.object(backend, "PARSEC_SAVINGS_BIN", "/missing/parsec"), \
                patch.object(backend.subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual(backend.parsec_savings(), {"error": "parsec_savings_unavailable"})


if __name__ == "__main__":
    unittest.main()
