import os
import unittest
from unittest.mock import patch

import backend


class SSHBindAddressTests(unittest.TestCase):
    def test_configured_source_address_is_passed_to_ssh(self):
        output = (
            "0.1 0.2 0.3 1/10 1\n---\n"
            "86400.0 100.0\n---\n"
            "cpu 100 0 0 100 0 0 0 0 0 0\n---\n"
            "Mem: 1000 200 0 0 0 800\n---\n"
            "/dev/sda1 20G 1G 19G 5% /\n---\n"
            "Test CPU\n---\n"
            "2\n"
        ).encode()

        with patch.dict(os.environ, {"SSH_BIND_ADDRESS": "185.130.107.79"}), \
                patch("backend.subprocess.check_output", return_value=output) as check_output:
            result = backend.ssh_collect("192.0.2.1", 40222, "root")

        command = check_output.call_args.args[0]
        bind_index = command.index("-b")
        destination_index = command.index("root@192.0.2.1")
        self.assertEqual(command[bind_index:bind_index + 2], ["-b", "185.130.107.79"])
        self.assertLess(bind_index, destination_index)
        self.assertTrue(result["online"])


if __name__ == "__main__":
    unittest.main()
