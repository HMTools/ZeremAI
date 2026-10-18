"""The version in plugin.json must have an entry in site/changelog.mdx."""
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class ChangelogTest(unittest.TestCase):
    def test_changelog_has_version(self):
        with open(os.path.join(ROOT, '.claude-plugin', 'plugin.json')) as f:
            version = json.load(f)['version']
        with open(os.path.join(ROOT, 'site', 'changelog.mdx')) as f:
            self.assertIn('<Update label="%s"' % version, f.read(), 'Add an entry for %s to site/changelog.mdx' % version)


if __name__ == '__main__':
    unittest.main()
