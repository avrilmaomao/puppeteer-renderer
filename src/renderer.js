'use strict'

const _ = require('lodash')
const yup = require('yup')
const puppeteer = require('puppeteer')

const waitForAnimations = require('./wait-for-animations')

const pageSchema = yup.object({
  timeout: yup.number().default(30 * 1000),
  waitUntil: yup.string().default('networkidle2'),
  credentials: yup.string(),
  headers: yup.string(),
  emulateMediaType: yup.string(),
})

const pdfSchema = yup.object({
  path: yup.string(),
  scale: yup.number().default(1.0),
  displayHeaderFooter: yup.boolean(),
  headerTemplate: yup.string(),
  footerTemplate: yup.string(),
  printBackground: yup.boolean(),
  landscape: yup.boolean(),
  pageRanges: yup.string(),
  format: yup.string(),
  width: yup.string(),
  height: yup.string(),
  margin: yup.object({
    top: yup.string(),
    right: yup.string(),
    bottom: yup.string(),
    left: yup.string(),
  }),
  preferCSSPageSize: yup.boolean(),
})

const screenshotSchema = yup.object({
  screenshotType: yup.string().default('png'), // instead of `type` property
  path: yup.string(),
  quality: yup.number().default(0),
  fullPage: yup.boolean(),
  clip: yup
    .object({
      x: yup.number(),
      y: yup.number(),
      width: yup.number(),
      height: yup.number(),
    })
    .default(undefined),
  omitBackground: yup.boolean(),
  encoding: yup.string(),

  // Extra options
  width: yup.number().default(800),
  height: yup.number().default(600),
  animationTimeout: yup.number().default(0),
})

class Renderer {
  constructor(browser) {
    this.browser = browser
  }

  async html(url, options = {}) {
    let page = null
    try {
      console.log("start render url:", url, options)
      const { timeout, waitUntil, credentials, headers } = options
      page = await this.createPage(url, { timeout, waitUntil, credentials, headers })
      const html = await page.content()
      console.log("finish rendering url:", url)
      return html
    } finally {
      this.closePage(page)
      console.log("close page:", url)
    }
  }

  async source(url, options = {}) {
    let page = null
    try {
      const { timeout, waitUntil, credentials, headers } = options
      let response = await this.createPage(url, { timeout, waitUntil, credentials, headers }, true)
      const source = await response.text()
      return source
    } finally {
      this.closePage(page)
    }
  }

  async pdf(url, options = {}) {
    let page = null
    try {
      const { timeout, waitUntil, credentials, headers, emulateMediaType, ...extraOptions } = options
      page = await this.createPage(url, {
        timeout,
        waitUntil,
        credentials,
        headers,
        emulateMediaType: emulateMediaType || 'print',
      })
      const pdfOptions = await pdfSchema.validate(extraOptions)

      const buffer = await page.pdf(pdfOptions)
      return buffer
    } finally {
      this.closePage(page)
    }
  }

  async screenshot(url, options = {}) {
    let page = null
    try {
      const { timeout, waitUntil, credentials, headers, ...restOptions } = options
      const {
        width,
        height,
        animationTimeout,
        ...validatedOptions
      } = await screenshotSchema.validate(restOptions)
      const screenshotOptions = {
        ..._.omit(validatedOptions, ['screenshotType']),
        type: validatedOptions.screenshotType,
        quality: validatedOptions.screenshotType === 'png' ? 0 : validatedOptions.quality,
      }

      page = await this.createPage(url, { timeout, waitUntil, credentials, headers })
      await page.setViewport({ width, height })

      if (animationTimeout > 0) {
        await waitForAnimations(page, screenshotOptions, animationTimeout)
      }

      const buffer = await page.screenshot(screenshotOptions)
      return {
        screenshotType: screenshotOptions.type,
        buffer,
      }
    } finally {
      this.closePage(page)
    }
  }

  async createPage(url, options = {}, onlyResponse = false) {
    const { timeout, waitUntil, credentials, emulateMediaType, headers } = await pageSchema.validate(options)
    console.log("page options",timeout, waitUntil)
    const page = await this.browser.newPage()

    if (headers) {
      await page.setExtraHTTPHeaders(JSON.parse(headers))
    }

    await page.setCacheEnabled(false)
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36")

    page.on('error', async error => {
      console.error(error)
      await this.closePage(page)
    })

    if (emulateMediaType) {
      await page.emulateMediaType(emulateMediaType)
    }

    if (credentials) {
      await page.authenticate(credentials)
    }
    if (onlyResponse){
      return await page.goto(url, { timeout, waitUntil })
    }else{
      await page.goto(url, { timeout, waitUntil })
    }
    return page
  }

  async closePage(page) {
    try {
      if (page && !page.isClosed()) {
        await page.close()
      }
    } catch (e) {}
  }

  async close() {
    await this.browser.close()
  }
}

async function create(options = {}) {
  const browser = await puppeteer.launch(Object.assign({ args: ['--no-sandbox'] }, options))
  return new Renderer(browser)
}

module.exports = create
