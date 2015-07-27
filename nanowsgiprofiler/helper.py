from warnings import warn
from itertools import chain
import sys
import os
PY2 = sys.version_info[0] == 2
if PY2:
    from urllib import quote
else:
    from urllib.parse import quote


if PY2:
    iteritems = lambda d: d.iteritems()
else:
    iteritems = lambda d: iter(d.items())


def insert_into_body(html, target):
    no_case = target.lower()
    body_end = no_case.rfind(b'</body>')

    if body_end >= 0:
        return target[:body_end] + html + target[body_end:]
    elif no_case.startswith(b'<!doctype html>'):  # HTML5
        return target + html
    else:
        warn('Failed to insert profile result')
        return target


def query_str2dict(query):
    if not query:
        return {}
    pairs = query.split('&')
    try:
        return dict(map(lambda pair: pair.split('='), pairs))
    except ValueError:
        return {}


def dict2query_str(dic):
    return '&'.join('%s=%s' % (k, v) for k, v in iteritems(dic))


_short_dir_cache = {}

def shorten_filename(name):
    dir_name, base_name = os.path.split(name)
    ret = _short_dir_cache.get(dir_name)
    if ret is not None:
        short_dir = _short_dir_cache[dir_name]
    else:
        origin_dir_name = dir_name
        # if the file is absolute, try normalizing it relative to ./
        # to handle it as a project file
        if os.path.isabs(dir_name):
            dir_name = _shortest_relative_path(dir_name, ['.'])

        if not os.path.isabs(dir_name):  # it is a project file
            short_dir = os.path.join('.', dir_name)
        else:  # otherwise, normalize other paths relative to library dirs
            dir_name = os.path.realpath(dir_name)  # deal with virtualenv
            short_dir = '<%s>' % _shortest_relative_path(dir_name, _py_libs)
        _short_dir_cache[origin_dir_name] = short_dir

    if short_dir.startswith('<'):
        return '<%s>' % os.path.join(short_dir[1:-1], base_name)
    else:
        return os.path.join(short_dir, base_name)


def _shortest_relative_path(name, paths):
    rel_paths = _relative_paths(name, paths)
    return min(chain(rel_paths, [name]), key=len)


def _relative_paths(value, paths):
    for i in paths:
        try:
            rel_path = os.path.relpath(value, i)
        except ValueError:
            # on Windows, relpath throws a ValueError for
            # paths with different drives
            continue
        if not rel_path.startswith('..'):
            yield rel_path


def get_python_lib():
    """Get path of libraries including standard and 3rd-party ones. For virtualenv,
    both virtual and real lib will be included. This is modified version of
    distutils.sysconfig.get_python_lib."""
    py_ver = sys.version[:3]

    def lib_for_prefix(prefix):
        if os.name == 'posix':
            standard = os.path.join(prefix, 'lib', 'python' + py_ver)
        elif os.name == 'nt':
            standard = os.path.join(prefix, 'Lib')
        else:
            warn('Failed to get python libraries')
            return []
        return [standard, os.path.join(standard, "site-packages")]

    if hasattr(sys, 'real_prefix'):  # virtualenv
        return lib_for_prefix(sys.real_prefix) + lib_for_prefix(sys.prefix)
    else:
        return lib_for_prefix(sys.prefix)


def reconstruct_path(environ):
    path = [quote(environ.get('SCRIPT_NAME', '')), quote(environ.get('PATH_INFO', ''))]
    query = environ.get('QUERY_STRING')
    if query:
        path.append('?' + query)
    return ''.join(path)

_py_libs = get_python_lib()
