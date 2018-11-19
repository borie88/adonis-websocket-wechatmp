'use strict'

/**
 * adonis-websocket-wechatmp
 * George Borrelli
 * 
 * Forked from adonis-websocket-client
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

import Connection from './src/Connection/index.js'

export default function (url, options) {
  return new Connection(url, options)
}
