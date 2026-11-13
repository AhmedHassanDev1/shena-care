"""Offline checks for the CLI boundary; never downloads a model."""
import importlib.util
from pathlib import Path
import ssl
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import requests


class CutoutBoundaryTest(unittest.TestCase):
    def test_keeps_tls_verification_and_reports_missing_birefnet(self):
        original_context = ssl._create_default_https_context
        original_request = requests.Session.request
        rembg = types.ModuleType("rembg")
        rembg.new_session = Mock(side_effect=[RuntimeError("model unavailable"), object()])
        rembg.remove = Mock(side_effect=lambda image, **kwargs: image)
        spec = importlib.util.spec_from_file_location("cutout", Path(__file__).with_name("birefnet-cutout.py"))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"rembg": rembg}):
            try:
                spec.loader.exec_module(module)
                self.assertIs(ssl._create_default_https_context, original_context)
                self.assertIs(requests.Session.request, original_request)
                with tempfile.TemporaryDirectory() as folder:
                    source = Path(folder) / "source.png"
                    Image.new("RGB", (32, 32), "white").save(source)
                    with self.assertRaisesRegex(RuntimeError, "model unavailable"):
                        module.process_file(source, Path(folder) / "output.png")
            finally:
                ssl._create_default_https_context = original_context
                requests.Session.request = original_request


if __name__ == "__main__":
    unittest.main()
