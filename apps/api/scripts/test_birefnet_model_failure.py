import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
from PIL import Image

class BiRefNetModelFailureTest(unittest.TestCase):
    def test_model_failure_never_substitutes_a_different_model_or_overwrites_original(self):
        session = Mock(side_effect=RuntimeError('MODEL_LOAD_FAILED'))
        remove = Mock()
        with patch.dict(sys.modules, {'rembg': types.SimpleNamespace(new_session=session, remove=remove)}):
            spec = importlib.util.spec_from_file_location('cutout_model_failure', Path(__file__).with_name('birefnet-cutout.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            with tempfile.TemporaryDirectory() as folder:
                source, target = Path(folder) / 'source.png', Path(folder) / 'derived.png'
                Image.new('RGB', (32, 32), 'white').save(source)
                original = source.read_bytes()
                with self.assertRaisesRegex(RuntimeError, 'MODEL_LOAD_FAILED'):
                    module.process_file(source, target)
                session.assert_called_once_with('birefnet-general')
                remove.assert_not_called()
                self.assertFalse(target.exists())
                self.assertEqual(source.read_bytes(), original)

if __name__ == '__main__':
    unittest.main()
