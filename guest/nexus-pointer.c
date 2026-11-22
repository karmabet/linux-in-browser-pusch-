/* Guest-side absolute pointer receiver for an isolated virtual serial port.
 * Build in a 32-bit Linux toolchain: zig cc -target x86-linux-gnu.2.34 nexus-pointer.c -o nexus-pointer -ldl
 * Configure the virtual serial port in raw mode before starting this receiver.
 * Run inside the X session: nexus-pointer /dev/ttyS1
 * Input lines: x y button state (button 0 moves; state 1 presses, 0 releases).
 */
#define _DEFAULT_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <string.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

typedef struct Display Display;
typedef unsigned long Window;

static int fake_input(Display *display, void *(*request)(Display *, uint8_t, size_t),
                      int opcode, int type, int detail, int x, int y)
{
    unsigned char *packet = request(display, (uint8_t)opcode, 36);
    if (!packet) return 0;
    memset(packet + 4, 0, 32);
    packet[1] = 2; /* XTEST FakeInput */
    packet[4] = (unsigned char)type;
    packet[5] = (unsigned char)detail;
    int16_t position[2] = { (int16_t)x, (int16_t)y };
    memcpy(packet + 24, position, sizeof(position));
    return 1;
}

int main(int argc, char **argv)
{
    if (argc != 2) return 2;
    void *xlib = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
    if (!xlib) { fputs("Could not load guest libX11.\n", stderr); return 1; }
    Display *(*XOpenDisplay)(const char *) = dlsym(xlib, "XOpenDisplay");
    int (*XQueryExtension)(Display *, const char *, int *, int *, int *) = dlsym(xlib, "XQueryExtension");
    void *(*request)(Display *, uint8_t, size_t) = dlsym(xlib, "_XGetRequest");
    int (*XDefaultScreen)(Display *) = dlsym(xlib, "XDefaultScreen");
    int (*XDisplayWidth)(Display *, int) = dlsym(xlib, "XDisplayWidth");
    int (*XDisplayHeight)(Display *, int) = dlsym(xlib, "XDisplayHeight");
    Window (*XRootWindow)(Display *, int) = dlsym(xlib, "XRootWindow");
    int (*XSync)(Display *, int) = dlsym(xlib, "XSync");
    int (*XQueryPointer)(Display *, Window, Window *, Window *, int *, int *, int *, int *, unsigned int *) = dlsym(xlib, "XQueryPointer");
    int (*XCloseDisplay)(Display *) = dlsym(xlib, "XCloseDisplay");
    if (!XOpenDisplay || !XQueryExtension || !request || !XDefaultScreen ||
        !XDisplayWidth || !XDisplayHeight || !XRootWindow || !XSync || !XQueryPointer || !XCloseDisplay) return 1;
    Display *display = XOpenDisplay(NULL);
    int opcode, event_base, error_base;
    if (!display || !XQueryExtension(display, "XTEST", &opcode, &event_base, &error_base)) {
        fputs("The guest X server must expose XTEST.\n", stderr);
        return 1;
    }

    int fd = open(argv[1], O_RDWR | O_NOCTTY);
    if (fd < 0 || !isatty(fd)) {
        perror("Opening guest pointer serial port");
        return 1;
    }
    FILE *input = fdopen(fd, "r");
    if (!input) return 1;

    int screen = XDefaultScreen(display);
    Window root = XRootWindow(display, screen);
    if (dprintf(fd, "READY\n") < 0) return 1;

    char line[80];
    while (fgets(line, sizeof(line), input)) {
        if (strcmp(line, "PING\n") == 0) {
            if (dprintf(fd, "READY\n") < 0) return 1;
            continue;
        }
        int x, y, button, state;
        char trailing;
        if (sscanf(line, "%d %d %d %d %c", &x, &y, &button, &state, &trailing) != 4 ||
            x < 0 || x >= XDisplayWidth(display, screen) ||
            y < 0 || y >= XDisplayHeight(display, screen) ||
            button < 0 || button > 5 || (state != 0 && state != 1)) continue;

        if (!fake_input(display, request, opcode, 6, 0, x, y)) return 1;
        if (button && !fake_input(display, request, opcode, state ? 4 : 5, button, 0, 0)) return 1;
        XSync(display, 0);

        /* Report the actual pointer coordinate from the guest X server. */
        if (button) {
            Window root_return, child;
            int root_x, root_y, local_x, local_y;
            unsigned int mask;
            if (!XQueryPointer(display, root, &root_return, &child,
                               &root_x, &root_y, &local_x, &local_y, &mask)) return 1;
            if (dprintf(fd, "BUTTON %d %d %d %d\n", button, state, root_x, root_y) < 0) return 1;
        }
    }
    fclose(input);
    XCloseDisplay(display);
    return 0;
}
