/**
 * KELVINET HELPDESK — kb-seed.js
 * ═══════════════════════════════════════════════════════════
 * Professional starter Knowledge Base. Every article follows the same shape:
 *   ## Summary → ## Quick checks → ## Steps → ## Escalate to IT if
 * so users get predictable guidance and engineers have a standard to follow
 * when they write new articles.
 *
 * Formatting understood by the app:  ## Heading · **bold** · "1." numbered
 * steps · "- " bullets. Loaded into Firestore by an admin from the Knowledge
 * Base tab ("Load Starter Articles"). Safe to run repeatedly (keyed by seedKey).
 */

export const STARTER_KB_VERSION = 1;

/** Titles of the older, thinner starter articles that the import replaces. */
export const LEGACY_STARTER_TITLES = [
  'cannot login / forgot password', 'printer not printing', 'wifi or internet not working',
  'wifi / internet not working', 'computer running slowly', 'email not working in outlook',
  'email not sending or receiving (outlook)', 'software installation guide', 'vpn connection issues',
  'screen or monitor not displaying', 'screen/monitor not displaying',
];

const a = (seedKey, title, category, tags, content) =>
  ({ seedKey, title, category, tags, content: content.trim() });

export const STARTER_KB = [

/* ───────────────────────── ACCOUNT ───────────────────────── */

a('password-reset-unlock', 'Reset a forgotten password or unlock your account', 'account',
  ['password', 'forgot', 'reset', 'login', 'sign in', 'locked', 'lockout', 'expired', 'account disabled', 'cannot log in'],
String.raw`
## Summary
Use this guide when you cannot sign in because you forgot your password, it has expired, or the account was locked after several failed attempts.
## Quick checks
- Caps Lock is off and the keyboard language is correct.
- You are signing in with your full work email address.
- If you have just failed several times, wait 15 to 30 minutes. Many accounts unlock automatically.
## Steps
1. On the sign-in page, select **Forgot password** (or **Can't access your account**).
2. Enter your work email address and complete the identity check (a code or an authenticator approval).
3. Create a new password of at least 12 characters. Use a passphrase and do not reuse an old password.
4. Sign in with the new password, then update it on your phone and in any mail apps so they do not lock the account again.
## Escalate to IT if
- The verification code does not arrive within 10 minutes.
- The message says the account is disabled or locked by an administrator.
- You suspect someone else has tried to access your account.
`),

a('mfa-setup-recovery', 'Set up or recover multi-factor authentication (MFA)', 'account',
  ['mfa', '2fa', 'two factor', 'authenticator', 'verification code', 'new phone', 'otp', 'backup codes', 'lost phone'],
String.raw`
## Summary
Multi-factor authentication (MFA) adds a second check, such as an authenticator app code, when you sign in. Use this guide to set it up or to recover access after changing phones.
## Set up MFA
1. Install an authenticator app (Microsoft Authenticator or Google Authenticator) from your phone's official app store.
2. On the security settings page, choose **Add sign-in method** and select **Authenticator app**.
3. Scan the QR code with the app and enter the 6-digit code to confirm.
4. Save your backup codes somewhere safe, such as a password manager. Do not take a screenshot of the QR code.
## New or lost phone
1. If you still have the old phone, add the new device before wiping the old one.
2. If you do not, sign in with a backup code and register the new device.
3. If you have neither, raise a ticket. IT must verify your identity before resetting MFA.
## Escalate to IT if
- Codes are rejected even though the phone time is correct. Set the phone to automatic date and time first.
- You receive approval prompts you did not request. Deny them and report it immediately.
`),

/* ───────────────────────── NETWORK ───────────────────────── */

a('wifi-no-connection', 'WiFi will not connect, or connected but no internet', 'network',
  ['wifi', 'wi-fi', 'wireless', 'internet', 'no internet', 'router', 'connection', 'disconnected', 'limited connection', 'network'],
String.raw`
## Summary
Use this guide when your device cannot join the WiFi network, or shows as connected but web pages will not load.
## Quick checks
- Airplane mode is off and WiFi is switched on.
- Another phone or laptop can use the same network. If none can, the problem is the router or the internet line, not your device.
- You are within range of the access point.
## Steps
1. Turn WiFi off, wait 10 seconds, and turn it on again.
2. Select the network, choose **Forget**, then reconnect and re-enter the password.
3. Restart your device.
4. On Windows, right-click the WiFi icon and choose **Diagnose network problems**.
5. Open Command Prompt and run these commands one at a time: ipconfig /release, then ipconfig /renew, then ipconfig /flushdns.
6. If you manage the router, switch it off for 30 seconds and switch it back on.
## Escalate to IT if
- Your IP address starts with 169.254, which means the device is not getting an address from the network.
- Several people lose connectivity at the same time.
- The office network fails but your phone works on mobile data.
`),

a('slow-internet', 'Slow internet or WiFi that keeps disconnecting', 'network',
  ['slow internet', 'slow wifi', 'lagging', 'buffering', 'disconnecting', 'dropping', 'speed', 'video call lag', 'bandwidth'],
String.raw`
## Summary
Use this guide when browsing, video calls or downloads are slow, or WiFi keeps dropping.
## Quick checks
- Test your speed on your device, then on a second device, to see whether the problem is only yours.
- Move closer to the access point and away from thick walls, microwaves and cordless phones.
- Look for heavy background activity such as cloud sync, system updates or someone streaming video.
## Steps
1. Close unused browser tabs and pause large downloads or cloud backups.
2. If your device supports it, join the 5 GHz network for better speed at short range. Use 2.4 GHz for longer range.
3. Restart your device, then the router if you manage it.
4. Use a network cable for video calls when possible. It is more stable than WiFi.
5. Update the WiFi driver through Windows Update or the laptop maker's support page.
## Escalate to IT if
- Speeds are consistently far below what the internet plan promises.
- Disconnections happen at the same time every day.
- Only certain websites or applications are slow.
`),

a('vpn-issues', 'VPN will not connect or keeps disconnecting', 'network',
  ['vpn', 'remote access', 'tunnel', 'work from home', 'authentication failed', 'cannot connect to vpn', 'vpn error'],
String.raw`
## Summary
Use this guide when the VPN will not connect, disconnects often, or connects but company resources cannot be reached.
## Quick checks
- Your normal internet works before you start the VPN.
- Your password has not expired and you are approving the MFA prompt.
- The VPN client is up to date.
## Steps
1. Disconnect and reconnect. If the client offers more than one server, try another.
2. Close and reopen the VPN client, or restart the computer.
3. Make sure no other VPN or proxy software is running.
4. Test on a different network, for example your phone's hotspot. If it works there, the first network is blocking VPN traffic.
5. Open Command Prompt and run: ipconfig /flushdns
6. Reinstall the VPN client if the problem continues.
## Escalate to IT if
- You get a certificate error or "authentication failed" after confirming your password.
- The VPN connects but file shares or internal sites do not open.
## Include in your ticket
The exact error message, the time it happened, and the network you were using.
`),

a('shared-drive-access', 'Cannot open a shared drive or network folder', 'network',
  ['shared drive', 'network drive', 'network folder', 'file server', 'mapped drive', 'access denied', 'network path not found', 'permission'],
String.raw`
## Summary
Use this guide when a shared drive or network folder will not open, or shows "access denied" or "network path not found".
## Quick checks
- You are on the office network or connected to the VPN.
- You are using the correct path, for example \\server\sharename, or the right mapped drive letter.
- Other colleagues can open the same folder.
## Steps
1. Open File Explorer, type the full path in the address bar and press Enter.
2. If the drive letter shows a red cross, right-click it, choose **Disconnect**, then map it again with **Map network drive**.
3. Open **Credential Manager > Windows Credentials**, remove any saved entry for the server, and try again with your current password.
4. Restart the computer, then connect to the network or VPN before opening the folder.
## Escalate to IT if
- You see **Access denied**. You may need permission, which your manager approves through a ticket.
- Nobody can reach the server, as it may be down.
`),

/* ───────────────────────── HARDWARE ───────────────────────── */

a('pc-slow-freezing', 'Computer running slowly or freezing', 'hardware',
  ['slow', 'slow computer', 'lag', 'freeze', 'freezing', 'hanging', 'performance', 'high cpu', 'disk 100', 'not responding', 'takes long to start'],
String.raw`
## Summary
Use this guide when a computer is slow to start, applications lag, or the screen freezes.
## Quick checks
- Restart the computer. Choosing **Shut down** with Fast Startup enabled does not fully reset Windows, so use **Restart**.
- The drive has at least 15% free space.
- Windows has no pending updates.
## Steps
1. Press Ctrl + Shift + Esc to open Task Manager. Sort by **CPU**, **Memory** and **Disk** to see what is using resources, and close anything unnecessary.
2. Open the **Startup apps** tab and disable programs you do not need at login.
3. Open **Settings > System > Storage** and remove temporary files and large unused files.
4. Open **Windows Security** and run a **Full scan** to rule out malware.
5. Install pending updates and restart.
## Escalate to IT if
- Disk usage stays at 100% on an older hard disk drive. The drive may be failing and an SSD upgrade may be needed.
- Memory usage stays above 90% with only a few applications open.
- The computer is more than four years old and still slow after a clean restart.
`),

a('printer-not-printing', 'Printer not printing or showing offline', 'hardware',
  ['printer', 'print', 'printing', 'offline', 'paper jam', 'toner', 'print queue', 'spooler', 'cannot print', 'printer offline'],
String.raw`
## Summary
Use this guide when documents do not print, stay stuck in the queue, or the printer shows as offline.
## Quick checks
- The printer is on, has paper and toner, and shows no error light or paper jam.
- You selected the correct printer and the cable or network connection is secure.
- Printing from another computer works. If it does not, the printer itself is the problem.
## Steps
1. Open **Settings > Bluetooth & devices > Printers & scanners**, select the printer, open the print queue and cancel all documents.
2. Press Windows key + R, type services.msc, find **Print Spooler**, right-click it and choose **Restart**.
3. In the printer's menu, make sure **Use Printer Offline** is not ticked.
4. Remove the printer and add it again. For a network printer, print its configuration page to confirm its IP address, then test that address from your computer with ping.
5. Reinstall the driver from the manufacturer's website if the problem remains.
## Escalate to IT if
- The printer shows a hardware error or keeps jamming.
- Installing a driver needs administrator rights.
- Several users cannot print to the same printer.
`),

a('display-not-working', 'Monitor, laptop screen or projector shows no picture', 'hardware',
  ['monitor', 'screen', 'display', 'black screen', 'no signal', 'hdmi', 'vga', 'projector', 'flickering', 'second screen'],
String.raw`
## Summary
Use this guide when a monitor, laptop screen or projector shows no picture, a black screen, or "No signal".
## Quick checks
- The monitor is powered on and its power light is lit.
- Cables are firmly connected at both the monitor and the computer.
- The monitor input source (HDMI, DisplayPort or VGA) matches the cable you are using.
## Steps
1. Press Windows key + P and choose **Duplicate** or **Extend**, in case the display mode changed.
2. Try a different cable or a different port on the computer.
3. Test the monitor with another computer to find out which device is at fault.
4. On Windows, press Windows key + Ctrl + Shift + B to restart the graphics driver.
5. Restart the computer with only one display connected, then reconnect the others.
## Escalate to IT if
- There is no picture even during startup, or the computer beeps repeatedly.
- The screen is cracked, has lines, or flickers on every cable and port.
`),

a('laptop-power-battery', 'Laptop will not turn on or battery will not charge', 'hardware',
  ['laptop', 'battery', 'charging', 'charger', 'will not turn on', 'dead', 'power', 'not charging', 'adapter', 'swollen battery'],
String.raw`
## Summary
Use this guide when a laptop will not turn on or its battery does not charge.
## Quick checks
- The charger is plugged firmly into both the wall and the laptop, and the socket works.
- The charger's wattage matches the laptop. A weaker charger may not charge it.
- Disconnect USB drives, docks and other accessories.
## Steps
1. Unplug the charger. If the battery is removable, take it out. Hold the power button for 30 seconds, then reconnect and power on.
2. Try a different outlet, or a known good charger of the same rating.
3. Check the charging light, and look for a loose or damaged charging port.
4. If the laptop starts, open Command Prompt and run: powercfg /batteryreport. Compare the design capacity with the full charge capacity in the report. A battery far below its design capacity needs replacing.
## Safety
Stop using the laptop and unplug it if the battery is swollen, very hot, or smells of burning. Report it to IT immediately.
## Escalate to IT if
- The laptop stays dead after the steps above.
- The battery lasts only a few minutes.
`),

a('peripherals-usb', 'Keyboard, mouse, headset or USB device not working', 'hardware',
  ['keyboard', 'mouse', 'usb', 'bluetooth', 'headset', 'webcam', 'not detected', 'device not recognised', 'touchpad', 'flash drive'],
String.raw`
## Summary
Use this guide when a keyboard, mouse, headset, webcam or USB drive is not detected or stops responding.
## Quick checks
- Replace the batteries or recharge wireless devices.
- Plug the device into a different USB port, directly on the computer rather than into a hub.
- Test the device on another computer to see whether the device or the computer is at fault.
## Steps
1. For Bluetooth devices, open **Settings > Bluetooth & devices**, remove the device, put it in pairing mode and add it again.
2. Open **Device Manager**, right-click the device (or the "Unknown device"), choose **Uninstall device**, then select **Action > Scan for hardware changes**.
3. Restart the computer with the device unplugged, then plug it in after Windows has loaded.
4. Install the latest driver from the manufacturer if the device is still not recognised.
## Escalate to IT if
- The device fails on every computer, which means it needs replacing.
- A USB port is physically loose or damaged.
`),

a('bsod-restarts', 'Blue screen (BSOD) or unexpected restarts', 'hardware',
  ['blue screen', 'bsod', 'stop code', 'restarting', 'crash', 'memory management', 'restarts by itself', 'reboot loop', 'shutdown'],
String.raw`
## Summary
Use this guide when Windows shows a blue screen error or the computer restarts without warning.
## Quick checks
- Note the **stop code** on the blue screen, for example MEMORY_MANAGEMENT, and take a photo of it with your phone.
- Think about what changed recently: a new device, driver, update or program.
- Disconnect any new USB device or hardware.
## Steps
1. Install pending Windows updates and driver updates, then restart.
2. Open Command Prompt as administrator and run: sfc /scannow. When it finishes, run: DISM /Online /Cleanup-Image /RestoreHealth.
3. Search for **Windows Memory Diagnostic** in the Start menu and run it to test the memory.
4. Make sure the computer is not overheating. Clear dust from the vents and keep it off soft surfaces.
5. If the problem began after a new update or driver, uninstall that update or roll back the driver.
## Escalate to IT if
- The blue screen returns more than once. Include the stop code and the time in your ticket.
- Windows will not start at all.
`),

/* ───────────────────────── SOFTWARE ───────────────────────── */

a('windows-update-install', 'Windows Update or software installation fails', 'software',
  ['install', 'installation', 'update', 'windows update', 'setup', 'installer', 'driver', 'error code', 'cannot install', 'update stuck'],
String.raw`
## Summary
Use this guide when Windows Update fails or stalls, or a program will not install or update.
## Quick checks
- You have at least 20 GB of free disk space for large updates.
- The computer is plugged in and connected to a stable network.
- The software is approved by IT. Do not install unapproved programs.
## Steps
1. Restart the computer and try again.
2. Open **Settings > System > Troubleshoot > Other troubleshooters** and run the **Windows Update** troubleshooter.
3. For a failed installer, right-click it and choose **Run as administrator** if you have permission.
4. If an earlier attempt half-installed, remove it from **Settings > Apps > Installed apps**, restart, and install again.
5. Pause cloud sync and close other programs while installing.
## Escalate to IT if
- You see an error code such as 0x800f0922 or 0x80070005. Include it in the ticket.
- The installer asks for administrator credentials you do not have.
- You need new software. Raise a software request with your manager's approval.
`),

a('office-apps-crash', 'Word, Excel, PowerPoint or Outlook will not open or keeps crashing', 'software',
  ['word', 'excel', 'powerpoint', 'office', 'microsoft 365', 'crash', 'not responding', 'will not open', 'add-in', 'repair office', 'freezes'],
String.raw`
## Summary
Use this guide when Word, Excel, PowerPoint or Outlook will not open, freezes, or keeps crashing.
## Quick checks
- Save work in other documents and close the application fully.
- Check for updates: **File > Account > Update Options > Update Now**.
- Check whether only one particular file causes the problem.
## Steps
1. Hold the Ctrl key while opening the application to start in Safe Mode, and see whether it opens normally.
2. If it does, disable add-ins in **File > Options > Add-ins > Manage COM Add-ins > Go**, then turn them back on one at a time.
3. Open **Settings > Apps > Installed apps**, choose **Microsoft 365** (or Office), select **Modify**, and run **Quick Repair**. If that fails, run **Online Repair**.
4. To recover unsaved work, open **File > Info > Manage Document > Recover Unsaved Documents**.
## Escalate to IT if
- Online Repair does not help.
- The same file crashes the application on several computers, which suggests the file is corrupt.
`),

a('teams-zoom-av', 'Camera or microphone not working in Teams or Zoom', 'software',
  ['teams', 'zoom', 'meeting', 'camera', 'microphone', 'mic', 'speaker', 'headset', 'audio', 'cannot hear', 'cannot see', 'video call'],
String.raw`
## Summary
Use this guide when your camera, microphone or speakers do not work in Teams, Zoom or other meeting software.
## Quick checks
- Your headset is plugged in or connected by Bluetooth, and is not muted by a switch or button.
- No other program is using the camera. Close other meeting apps.
- Windows allows apps to use them: **Settings > Privacy & security > Camera** and **Microphone**.
## Steps
1. In the meeting app's settings, select the correct camera, microphone and speaker from the device lists.
2. Open **Settings > System > Sound** and check that the correct input and output devices are selected and the volume is up.
3. Test the camera in the Windows **Camera** app. If it works there, the problem is in the meeting app.
4. Unplug and replug USB devices, then restart the meeting app.
5. Update the meeting app and restart the computer.
## Escalate to IT if
- The camera or microphone does not appear in Device Manager.
- Only a company-managed meeting app is affected, which may be caused by a policy setting.
`),

a('browser-problems', 'Websites will not load, load slowly or show security warnings', 'software',
  ['browser', 'chrome', 'edge', 'firefox', 'website', 'page not loading', 'certificate', 'connection is not private', 'cache', 'cookies', 'extension'],
String.raw`
## Summary
Use this guide when websites will not load, load slowly, show security warnings, or a web application misbehaves.
## Quick checks
- Try the site in a private or incognito window. If it works there, an extension or the cache is the cause.
- Check that the computer's date and time are correct. A wrong clock causes certificate warnings.
- Try a different browser.
## Steps
1. Clear cached images and files and cookies for the site: press Ctrl + Shift + Delete.
2. Disable browser extensions one at a time to find a faulty one.
3. Update the browser to the latest version and restart it.
4. For "Your connection is not private" warnings, do not continue to sites where you enter passwords or payments. Report it to IT.
## Escalate to IT if
- A company web application fails on every browser and computer.
- You see certificate warnings on a site you normally use.
`),

a('recover-deleted-files', 'Recover a deleted, overwritten or missing file', 'software',
  ['deleted file', 'recover', 'restore', 'recycle bin', 'overwritten', 'lost file', 'previous versions', 'onedrive', 'missing file', 'unsaved'],
String.raw`
## Summary
Use this guide to get back a file you deleted, overwrote or cannot find.
## Quick checks
- Stop saving new files to the same location so the old data is not overwritten.
- Search for the file name using File Explorer or the Start menu. It may have been saved somewhere else.
## Steps
1. Open the **Recycle Bin**, find the file, right-click it and choose **Restore**.
2. For a OneDrive or SharePoint file, open the web version and check the **Recycle bin**, or right-click the file and choose **Version history** to restore an earlier version.
3. For a folder on your computer, right-click it, choose **Properties > Previous Versions** if available, and restore a version.
4. In Word, Excel or PowerPoint, use **File > Info > Manage Document > Recover Unsaved Documents**.
## Escalate to IT if
- The file was on a company server or shared drive. IT can restore it from backup. Include the full path and when you last saw the file.
`),

/* ───────────────────────── EMAIL ───────────────────────── */

a('outlook-send-receive', 'Outlook will not send or receive email', 'email',
  ['outlook', 'email', 'send', 'receive', 'outbox', 'disconnected', 'trying to connect', 'not receiving emails', 'not sending emails', 'smtp', 'stuck in outbox'],
String.raw`
## Summary
Use this guide when Outlook will not send or receive mail, shows **Disconnected** or **Trying to connect**, or messages are stuck in the Outbox.
## Quick checks
- Your internet or VPN works.
- On the **Send / Receive** tab, **Work Offline** is not highlighted.
- Sign in to webmail in a browser. If webmail works, the account is fine and the problem is in Outlook.
## Steps
1. Open the Outbox. If a message with a large attachment is stuck, move it to Drafts and resend it without the attachment, or share a link instead.
2. Close Outlook fully and reopen it. Hold Ctrl while opening to start in Safe Mode.
3. Open **File > Account Settings > Account Settings**, select the account and choose **Repair**.
4. Check that the mailbox is not full (see the article on a full mailbox).
5. Check that your password has not expired, and sign in again if prompted.
## Escalate to IT if
- Webmail also fails or shows an error.
- Messages bounce back with a delivery error. Include the full error text in your ticket.
- Outlook keeps asking for the password after you have reset it.
`),

a('mailbox-full-slow-outlook', 'Mailbox full, or Outlook running slowly', 'email',
  ['mailbox full', 'storage', 'quota', 'archive', 'outlook slow', 'attachments', 'large mailbox', 'mailbox cleanup', 'deleted items'],
String.raw`
## Summary
Use this guide when you see a "mailbox full" warning, or Outlook is slow because of a large mailbox.
## Steps
1. Open **File > Info > Tools > Mailbox Cleanup** to see the size of your mailbox and its folders.
2. Empty the **Deleted Items** and **Junk Email** folders.
3. Sort a folder by **Size**, then delete large attachments or save them to OneDrive or the shared drive.
4. Move old items you must keep into an archive (**File > Info > Tools > Clean Up Old Items**, or an online archive if your company provides one).
5. Share large files with a link instead of attaching them.
## Escalate to IT if
- You need a larger mailbox. Raise a ticket with your manager's approval.
- Outlook stays slow after cleaning up.
`),

/* ───────────────────────── SECURITY ───────────────────────── */

a('phishing-report', 'Suspicious or phishing email: what to do', 'security',
  ['phishing', 'suspicious email', 'scam', 'spam', 'fake email', 'clicked a link', 'attachment', 'spoof', 'fraud', 'report phishing'],
String.raw`
## Summary
Phishing emails try to trick you into clicking a link, opening an attachment, or giving away a password or payment. Follow this guide if an email looks suspicious.
## Warning signs
- Urgent or threatening language, or an unexpected request for money, gift cards, passwords or codes.
- A sender address that looks slightly wrong or does not match the company name.
- Links that show a different address when you hover over them, or attachments you were not expecting.
## What to do
1. Do not click links, open attachments or reply.
2. Use the **Report phishing** button in your mail app, or forward the email to IT as an attachment.
3. Delete the email.
4. If you called a number or approved a payment because of the message, tell your manager and IT at once.
## If you already clicked or entered a password
1. Disconnect from the network if a file was downloaded.
2. Change your password from a different, trusted device.
3. Raise a **Critical** ticket right away so IT can check your account and sign you out everywhere.
`),

a('malware-suspected', 'Suspected virus or ransomware infection', 'security',
  ['virus', 'malware', 'ransomware', 'infected', 'pop-ups', 'hacked', 'ransom note', 'files encrypted', 'suspicious program', 'antivirus'],
String.raw`
## Summary
Use this guide if you suspect a virus, ransomware or other malware: pop-ups, unknown programs, files that cannot be opened or have changed names, or a ransom message.
## Act immediately
1. Disconnect the computer from the network: unplug the cable and turn off WiFi.
2. Leave the computer on unless IT tells you otherwise, and do not plug in USB drives.
3. Raise a **Critical** ticket, or call IT, and describe what you saw and when it started.
4. From a different, trusted device, change the passwords of your important accounts.
## What not to do
- Do not pay any ransom or contact the sender.
- Do not keep working, or copy files from the computer to other devices.
- Do not log in to company systems from the affected computer.
## If you see only mild symptoms
Run a **Full scan** in **Windows Security > Virus & threat protection > Scan options**, then report the result in a ticket.
`),

a('lost-stolen-device', 'Lost or stolen laptop, phone or storage device', 'security',
  ['lost laptop', 'stolen laptop', 'stolen phone', 'lost phone', 'theft', 'missing device', 'police', 'remote wipe', 'lost usb', 'lost device'],
String.raw`
## Summary
A lost or stolen laptop, phone or storage device can expose company data. Speed matters.
## Steps
1. Report it to IT and your manager immediately, even if you hope to find it. Use a **Critical** ticket or call IT.
2. If it was stolen, report it to the police and obtain the occurrence book (OB) number or a police abstract.
3. Tell IT the device model, serial number or asset tag, and when and where you last had it.
4. Tell IT what kind of data was stored on it so the impact can be assessed.
5. IT will lock or wipe the device remotely if it is managed, disable access and end active sessions.
6. From a different device, change your passwords, starting with your email.
## Prevention
- Keep devices with you and lock the screen when you step away.
- Use a screen lock and disk encryption.
- Do not keep passwords in notes or on paper stored with the device.
`),

/* ───────────────────────── OTHER ───────────────────────── */

a('remote-support-guide', 'How to request remote support (RustDesk or AnyDesk)', 'other',
  ['remote support', 'remote access', 'rustdesk', 'anydesk', 'screen sharing', 'engineer connect', 'remote session', 'session id', 'remote help'],
String.raw`
## Summary
Remote support lets an IT engineer see and control your screen to fix a problem. It is only ever started by you, through a ticket.
## How to request it
1. Install RustDesk (rustdesk.com) or AnyDesk (anydesk.com) from the official website only.
2. Open the program and note the **ID** it shows, a number such as 123 456 789.
3. Create or update your ticket, choose the program in the **Remote Support** section and enter the ID.
4. The engineer connects using their own copy. Approve the connection when the prompt appears on your screen.
5. Watch the session. You can end it at any time by choosing **Disconnect** or closing the program.
## Stay safe
- Never share your ID or password with anyone who contacts you unexpectedly, even if they say they are from IT.
- Only accept connection requests that match a ticket you created.
- Close the program when the session ends. Uninstall it if you no longer need it.
`),

a('ticket-best-practice', 'How to write a ticket that gets resolved faster', 'other',
  ['ticket', 'support request', 'how to raise a ticket', 'priority', 'create ticket', 'log a ticket', 'what to include', 'screenshot'],
String.raw`
## Summary
A clear ticket is resolved faster. Include the following when you ask for help.
## What to include
1. **What happened**: the exact error message, or a screenshot or photo of it.
2. **When it started**, and whether it ever worked before.
3. **What changed recently**: an update, new software, a new device or a password change.
4. **What you have already tried**, so the engineer does not repeat it.
5. **Which device and where**: the computer name or asset tag, and your location.
6. **Impact**: whether you cannot work at all, or can work around the problem.
## Choosing a priority
- **Critical**: a security incident, or many people cannot work.
- **High**: you cannot do your job and have no workaround.
- **Normal**: something is broken but you can still work.
- **Low**: a question or a minor request.
`),

a('request-software-access', 'Request new software, equipment or system access', 'other',
  ['new software', 'request software', 'new laptop', 'equipment request', 'access request', 'permission', 'licence', 'new starter', 'new employee', 'install request'],
String.raw`
## Summary
Use this guide to ask for new software, equipment, accounts or permissions.
## Steps
1. Raise a ticket and choose the closest category: software, hardware or account.
2. State what you need and the business reason.
3. Include the name of the person approving it, usually your manager. Requests for access, new software or equipment normally need written approval.
4. For software, give its name and version, and say whether you already have a licence.
5. IT will confirm the cost, security approval and delivery time in the ticket.
## Good to know
- Do not install software yourself without approval.
- New employee accounts and equipment should be requested at least a few days before the start date.
`),

];
