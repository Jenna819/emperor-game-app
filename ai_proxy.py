#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""皇帝后宫养成 · 本地 AI 聊天代理
用法: python3 ai_proxy.py   (默认端口 8787)
配置: 同目录 .env 文件 (参考 .env.example)
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8787
BLOCKED = ['手机', '电脑', '汽车', '飞机', '炸弹', '开枪', '射击', '互联网', '微信',
           '做爱', '性行为', '自杀', '自残', '强奸', '裸露', '裸照', '吸毒', '毒品']


def load_env():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                os.environ.setdefault(k.strip(), v.strip())


load_env()
API_KEY = os.environ.get('AI_API_KEY', '')
BASE_URL = os.environ.get('AI_BASE_URL', 'https://api.deepseek.com/v1').rstrip('/')
MODEL = os.environ.get('AI_MODEL', 'deepseek-chat')
TEMPERATURE = float(os.environ.get('AI_TEMPERATURE', '0.9'))
MAX_TOKENS = int(os.environ.get('AI_MAX_TOKENS', '160'))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('[ai_proxy] %s\n' % (fmt % args))

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/ping':
            self._json(200, {'ok': True, 'model': MODEL, 'configured': bool(API_KEY)})
        else:
            self._json(404, {'error': 'not found'})

    def _call_upstream(self, messages, temperature, max_tokens, want_json, timeout):
        payload = json.dumps({
            'model': MODEL,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens,
            'stream': False,
            **({'format': 'json'} if (want_json and '11434' in BASE_URL) else {}),
        }).encode('utf-8')
        up = urllib.request.Request(
            BASE_URL + '/chat/completions', data=payload, method='POST',
            headers={'Content-Type': 'application/json',
                     'Authorization': 'Bearer ' + API_KEY})
        with urllib.request.urlopen(up, timeout=timeout) as resp:
            data = json.loads(resp.read())
        return data['choices'][0]['message']['content'] or ''

    def do_POST(self):
        if self.path == '/narrate':
            self._handle_narrate()
            return
        if self.path != '/chat':
            self._json(404, {'error': 'not found'})
            return
        if not API_KEY:
            self._json(500, {'error': 'AI_API_KEY 未配置，请编辑 .env'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            req = json.loads(self.rfile.read(length))
            messages = req.get('messages', [])
            user_text = ' '.join(m.get('content', '') for m in messages if m.get('role') == 'user')
            if any(w in user_text for w in BLOCKED):
                self._json(403, {'error': 'filtered'})
                return
            content = self._call_upstream(
                messages, float(req.get('temperature', TEMPERATURE)),
                int(req.get('max_tokens', MAX_TOKENS)), True, 25)
            self._json(200, {'content': content})
        except urllib.error.HTTPError as e:
            self._json(502, {'error': 'upstream %d: %s' % (e.code, e.read()[:200].decode('utf-8', 'ignore'))})
        except Exception as e:
            self._json(500, {'error': str(e)[:300]})

    def _handle_narrate(self):
        # 叙事长文：单轮、放行古风宫廷词、不强制 JSON、max_tokens 更大
        if not API_KEY:
            self._json(500, {'error': 'AI_API_KEY 未配置，请编辑 .env'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            req = json.loads(self.rfile.read(length))
            if 'messages' in req:
                messages = req['messages']
            else:
                messages = []
                if req.get('system'):
                    messages.append({'role': 'system', 'content': req['system']})
                messages.append({'role': 'user', 'content': req.get('user', '')})
            content = self._call_upstream(
                messages, float(req.get('temperature', 1.0)),
                int(req.get('max_tokens', 1200)), False, 60)
            self._json(200, {'content': content})
        except urllib.error.HTTPError as e:
            self._json(502, {'error': 'upstream %d: %s' % (e.code, e.read()[:200].decode('utf-8', 'ignore'))})
        except Exception as e:
            self._json(500, {'error': str(e)[:300]})


if __name__ == '__main__':
    if not API_KEY:
        print('警告: 未找到 .env 或其中没有 AI_API_KEY，/chat 将返回 500。参考 .env.example 创建 .env')
    bind = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    print('AI 代理已启动: http://%s:%d  (模型: %s, 上游: %s)' % (bind, PORT, MODEL, BASE_URL))
    ThreadingHTTPServer((bind, PORT), Handler).serve_forever()
