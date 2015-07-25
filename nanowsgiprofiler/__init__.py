import time
from os import path
try:
    from cProfile import Profile
except ImportError:
    from profile import Profile
import pstats
from wsgiref.headers import Headers
from jinja2 import Template
from nanowsgiprofiler.helper import *
if PY2:
    from Cookie import Cookie
else:
    from http.cookie import Cookie


_file_path = path.abspath(path.dirname(__file__))

with open(path.join(_file_path, 'profiler.html'), 'rb') as _f:
    _template = Template(_f.read().decode('ascii'))


class NanoProfilerMiddleware(object):
    def __init__(self, app, simplify_output=True):
        self.toggle_key = b'_profiler'
        self.enable_value = b'on'
        self.disable_value = b'off'
        self._app = app
        self.simplify_output = simplify_output

    def __call__(self, environ, start_response):
        query = query_string2dict(environ.get('QUERY_STRING'))
        key_morsel = Cookie(environ.get('HTTP_COOKIE', '')).get(self.toggle_key)
        enabled_by_cookie = key_morsel.value == self.enable_value if key_morsel else False
        enabled_by_query = query.get(self.toggle_key) == self.enable_value

        if not enabled_by_query and not enabled_by_cookie:
            return self._app(environ, start_response)

        resp_body, saved_ss_args = [], []

        def start_response_proxy(*args):
            saved_ss_args.extend(args)
            return resp_body.append

        def run_app():
            app_iter = self._app(environ, start_response_proxy)
            resp_body.extend(app_iter)
            if hasattr(app_iter, 'close'):
                app_iter.close()

        start = time.time()
        profile = Profile()
        profile.runcall(run_app)  # here we call the WSGI app
        elapsed = time.time() - start

        status, headers = saved_ss_args[:2]
        headers_dic = Headers(headers)

        if not (status.startswith('200') and
                headers_dic.get('Content-Type', '').startswith('text/html')):
            start_response(*saved_ss_args)
            return resp_body

        # processing cookies which used to enable profiler
        if enabled_by_query and not enabled_by_cookie:
            headers_dic.add_header('Set-Cookie', '%s=%s; HttpOnly' % (self.toggle_key, self.enable_value))
        elif query.get(self.toggle_key) == self.disable_value:
            headers_dic.add_header('Set-Cookie', '%s=; Max-Age=1; HttpOnly' % self.toggle_key)

        rendered = self.render_result(profile, elapsed)
        # encode with ascii to avoid the trouble of finding encoding of original response, may be buggy!
        new_resp = insert_into_body(rendered.encode('ascii'), b''.join(resp_body))
        headers_dic['Content-Length'] = str(len(new_resp))
        start_response(status, headers)
        return [new_resp]

    def render_result(self, profile, time_elapsed):
        profile.create_stats()
        stats = profile.stats

        function_calls = []
        for func, info in iteritems(stats):
            current = {}
            filename = pstats.func_std_string(func)
            # hide our hook functions
            if filename.startswith(_file_path):
                continue

            # col0: filename
            if filename.startswith(('{', '<')):  # built-in functions
                name, name_full = filename, 'n/a'
            else:  # functions from library and our project
                name, name_full = shorten_filename(filename), filename
            current['filename'], current['filename_full'] = name, name_full

            # skip functions that is in library or built-in
            if self.simplify_output and name.startswith(('{', '<')):
                continue

            # col1: number of calls
            if info[0] != info[1]:
                current['ncalls'] = '%d/%d' % (info[1], info[0])
            else:
                current['ncalls'] = info[1]
            # col2: total time
            current['tottime'] = '{:.2f}'.format(info[2] * 1000)
            # col3: quotient of total time divided by number of calls
            if info[1]:
                current['percall'] = '{:.2f}'.format(info[2] * 1000 / info[1])
            else:
                current['percall'] = 0
            # col4: cumulative time
            current['cumtime'] = '{:.2f}'.format(info[3] * 1000)
            # col5: quotient of the cumulative time divided by the number of
            # primitive calls.
            if info[0]:
                current['percall_cum'] = '{:.2f}'.format(info[3] * 1000 / info[0])
            else:
                current['percall_cum'] = 0

            function_calls.append(current)

        return _template.render(ms_elapsed=int(time_elapsed * 1000), function_calls=function_calls)
