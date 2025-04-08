const {app, BrowserWindow, ipcMain, Menu, MenuItem, dialog, session, protocol} = require('electron/main')
const {exec, spawn} = require('child_process')
const path = require('path')
// const http = require("http");
const fs = require('fs-extra')
const mime = require('mime')
const tga2png = require('tga2png')
const {fileURLToPath} = require('url')

app.commandLine.appendSwitch('charset', 'utf-8');
process.env.CACHE_PATH = path.join(__dirname, 'cache')
process.env.FFMPEG_PATH = path.join(__dirname, 'ffmpeg', 'ffmpeg.exe');

let win;

const createWindow = (log) => {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        minWidth: 400,
        minHeight: 140,
        fullscreenable: false,
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.on('maximize', () => {
        win.webContents.send('set-maximized-icon')
    })

    win.on('unmaximize', () => {
        win.webContents.send('set-unmaximized-icon')
    })

    if (process.env.IS_DEV) {
        win.loadURL('http://localhost:8192').then(() => {
            win.webContents.send('logging', log)
        })
        win.openDevTools({mode: 'detach'})
    } else {
        win.loadFile('./dist/index.html').then(() => {
            win.webContents.send('logging', log)
        })
    }
}

// const server = http.createServer((req, res) => {
//     let filePath = decodeURIComponent(req.url.slice(1))
//     let fileExists;
//     if (filePath.endsWith('.atlas')) {
//         let txtPath = filePath + '.txt'
//         filePath = (fs.existsSync(filePath) && filePath) || (fs.existsSync(txtPath) && txtPath)
//         fileExists = !!filePath
//     } else {
//         fileExists = fs.existsSync(filePath)
//     }
//     if (!fileExists) {
//         res.writeHead(404);
//         res.end('File not found');
//         return;
//     }
//
//     fs.readFile(filePath, (err, data) => {
//         if (err) {
//             res.writeHead(500);
//             res.end('Error loading file');
//             return;
//         }
//         res.writeHead(200);
//         res.end(data);
//     });
// });
//
// server.listen(0, 'localhost', () => {
// });


app.whenReady().then(() => {
    let log = {
        name: 'app',
        error: ''
    }
    if (!fs.existsSync(process.env.CACHE_PATH)) {
        fs.mkdirSync(process.env.CACHE_PATH, {recursive: true});
    } else {
        fs.emptydir(process.env.CACHE_PATH).then(() => console.log('Clear cache'))
    }
    if (!fs.existsSync(process.env.FFMPEG_PATH)) {
        log.error = 'ffmpeg not found!'
    }

    createWindow(log)

    protocol.handle('file', async (request) => {
        let filePath = fileURLToPath(request.url)
        if (filePath.endsWith('.atlas') && !fs.existsSync(filePath)) {
            filePath = `${filePath}.txt`
        }
        try {
            const fileContent = fs.readFileSync(filePath)
            const mimeType = mime.getType(filePath)
            if (filePath.endsWith('.json')) {
                const jsonObject = JSON.parse(fileContent)
                if (jsonObject.hasOwnProperty('skeleton') && jsonObject.skeleton.spine.substr(0, 3) === '4.2') {
                    jsonObject.skeleton.spine = '4.1-force-load'
                    jsonObject.bones.forEach(bone => {
                        if (bone.hasOwnProperty('inherit')) {
                            bone.transform = bone.inherit
                        }
                    })
                    if (jsonObject.hasOwnProperty('physics')) {
                        jsonObject.physics.forEach(constraint => {
                            const sortViaTransform = { 'name': constraint.name, 'order': constraint.order, 'bones': [], 'target': constraint.bone }
                            if (!jsonObject.hasOwnProperty('transform')) {
                                jsonObject.transform = []
                            }
                            jsonObject.transform.push(sortViaTransform)
                        })
                    }
                }
                jsonContent = JSON.stringify(jsonObject)
                return new Response(jsonContent, {
                    headers: { 'Content-Type': 'application/json' }
                })
            } else if (filePath.endsWith('.tga')) {
                const pngBuffer = await tga2png(filePath)
                return new Response(pngBuffer, {
                    headers: { 'Content-Type': 'image/png' }
                })
            } else {
                return new Response(fileContent, {
                    headers: { 'Content-Type': mimeType || 'application/octet-stream' }
                })
            }
        } catch (error) {
            return new Response(`Failed to read file: ${error.message}`, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            })
        }
    })

    ipcMain.handle('port', () => server.address().port)

    ipcMain.on('open-devtools', () => win.webContents.openDevTools({mode: 'detach'}))
    ipcMain.on('minimize', () => win.minimize())
    ipcMain.on('toggle-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
    ipcMain.on('close', () => win.close())
    ipcMain.on('show-context-menu', (ev) => {
        const contextMenu = new Menu();
        contextMenu.append(new MenuItem({
            label: 'Copy image',
            click: () => {
                win.webContents.send('copy-image')
            }
        }));
        contextMenu.popup(win, ev.x, ev.y);
    })

    ipcMain.handle('save-image', (ev, ab, name) => {
        const imagePath = dialog.showSaveDialogSync(win, {
            title: 'Save image',
            defaultPath: name,
            properties: ['createDirectory'],
            filters: [{name: 'PNG', extensions: ['png']}]
        })
        if (imagePath) {
            try {
                fs.writeFileSync(imagePath, Buffer.from(ab))
            } catch (e) {
                return e
            }
            return true
        }
        return false
    })

    // 导出gif相关
    ipcMain.handle('select-export-path', () => {
        const exportPath = dialog.showOpenDialogSync(win, {
            title: 'Output directory',
            properties: ['openDirectory']
        })
        return exportPath ? exportPath[0] : ''
    })
    ipcMain.handle('prepare-export', (ev) => {
        const pngPath = path.join(process.env.CACHE_PATH, 'png')
        if (!fs.existsSync(pngPath)) {
            fs.mkdirSync(pngPath, {recursive: true});
        }
    })
    ipcMain.handle('save-image-cache', (ev, image) => saveBase64Image(image))
    ipcMain.handle('compose', (ev, options) => {
        const imagePath = path.join(process.env.CACHE_PATH, 'png')
        const inputPath = path.join(imagePath, '%05d.png')
        const outputPath = path.join(options.path, options.filename)
        const ffmpegArgs = ['-y', '-r', options.framerate.toString(), '-i', inputPath]
        switch (options.format) {
            case 'MP4':
                ffmpegArgs.push(...['-vf', 'crop=if(mod(iw\\,2)\\,iw-1\\,iw):if(mod(ih\\,2)\\,ih-1\\,ih)', '-crf', '17', '-pix_fmt', 'yuv420p', `${outputPath}.mp4`])
                break
            case 'GIF-HQ':
                ffmpegArgs.push(...['-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', `${outputPath}.gif`])
                break
            case 'GIF':
                ffmpegArgs.push(`${outputPath}.gif`)
                break
            case 'PNG-SEQ':
                if (fs.existsSync(outputPath)) {
                    fs.removeSync(outputPath)
                }
                fs.move(imagePath, outputPath).then(() => {
                    win.webContents.send('export-complete')
                }).catch(error => {
                    win.webContents.send('logging', {name: 'move', error})
                })
                return
            case 'WEBM-VP9':
                ffmpegArgs.push(...['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '17', `${outputPath}.webm`])
                break
            default:
                break
        }
        const ffmpegProcess = spawn(process.env.FFMPEG_PATH, ffmpegArgs)
        ffmpegProcess.stdout.on('data', (data) => {
            win.webContents.send('logging', {name: 'ffmpeg', stdout: data.toString()})
        })
        ffmpegProcess.stderr.on('data', (data) => {
            win.webContents.send('logging', {name: 'ffmpeg', stderr: data.toString()})
        })
        ffmpegProcess.on('close', (code) => {
            fs.remove(imagePath).then(() => {
                win.webContents.send('export-complete')
            })
        })
    })

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})


// 将 base64 格式的图片保存为本地文件
function saveBase64Image(image) {
    const base64Image = image.data.split(';base64,').pop();
    const imageBuffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(path.join(process.env.CACHE_PATH, 'png', `${image.index}.png`), imageBuffer)
    return true
}