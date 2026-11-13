import importlib.util
from pathlib import Path
import ssl
import sys
import types
import unittest
from unittest.mock import patch
import requests


class BiRefNetTlsTest(unittest.TestCase):
    def test_import_never_replaces_verified_tls_or_requests_transport(self):
        original_context = ssl._create_default_https_context
        original_request = requests.Session.request
        fake_rembg = types.SimpleNamespace(remove=lambda *_a, **_k: None, new_session=lambda *_a, **_k: None)
        try:
            with patch.dict(sys.modules, {"rembg": fake_rembg}):
                spec = importlib.util.spec_from_file_location("birefnet_tls_under_test", Path(__file__).with_name("birefnet-cutout.py"))
                spec.loader.exec_module(importlib.util.module_from_spec(spec))
                self.assertIs(ssl._create_default_https_context, original_context)
                self.assertIs(requests.Session.request, original_request)
                self.assertTrue(ssl.create_default_context().check_hostname)
                self.assertEqual(ssl.create_default_context().verify_mode, ssl.CERT_REQUIRED)
        finally:
            ssl._create_default_https_context = original_context
            requests.Session.request = original_request


if __name__ == "__main__":
    unittest.main()
