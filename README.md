# Study Timer

A focus timer for studying, with task priorities, a dashboard of your study time and a calendar. It runs entirely in the browser with no build step and no dependencies.

## Features

**Timer**
- Focus, short break and long break sessions with a ticking dial
- Tag each session with a subject; add or remove subjects
- Finish a session early and still log the time
- Optional auto-start for the next session and a chime when a session ends
- Task list ordered by priority: add tasks, move them up or down, send one to the top, tick them off
- A Focus button on each task starts a session for it

**Dashboard**
- Today against your daily goal, this week against last week, streak and all-time total
- Stacked bar chart of study time per day (7, 14 or 30 days) with a goal line
- Time by subject and a list of recent sessions
- Month calendar shaded by how much you studied; click a day to see its sessions and add plans
- A sample data preview so you can see the dashboard before logging anything

## Run it

Open `index.html` in a browser. To serve it locally instead:

```sh
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, go to **Settings > Pages**.
3. Set the source to **Deploy from a branch**, pick `main` and `/ (root)`, and save.

## Project layout

```
index.html       page structure
css/styles.css   theme tokens (light and dark) and component styles
js/app.js        timer, tasks, dashboard, calendar and storage
```

## Where your data is kept

Sessions, tasks, plans and settings are saved in the browser's `localStorage` under the key `study-timer:v1`. Nothing is sent anywhere. Data stays on that browser and device, and clearing site data erases it.

## Notes

- Fonts (Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono) load from Google Fonts. Without a connection the page falls back to system fonts.
- The page follows your system light or dark setting.
