/**
 * Where is an NFC disk download inside the disk? (#807)
 *
 * vCenter exports a disk as a stream-optimized sparse extent: a 512 byte
 * header, the embedded descriptor, then one marker per allocated grain in
 * ascending disk order, each carrying the grain's sector address (LBA) and its
 * compressed length, and finally the grain tables, grain directory, footer and
 * an end-of-stream marker (VMware Virtual Disk Format 5.0). Because grains come
 * in disk order and unallocated grains are simply absent, the LBA of the last
 * complete grain on disk is the true position of the export inside the disk,
 * whatever the compression ratio and however thin the disk is.
 *
 * The probe below runs on the Proxmox node with the file being written under
 * it. It parses the header once, then walks the markers from where the
 * previous call stopped (`pos`), so each poll only reads what curl appended
 * since the last one. Perl is present on every Proxmox VE node.
 *
 * Output, one line: `size=<file bytes> pos=<resume offset> position=<bytes of
 * the disk streamed> capacity=<disk bytes> eos=<0|1>`. Before the header is
 * complete, or on a file that is not a sparse extent, capacity stays 0.
 */
export const NFC_STREAM_PROBE_SCRIPT = String.raw`use strict;
use warnings;
my ($file, $pos, $position) = @ARGV;
$pos = 0 unless defined $pos && $pos =~ /^\d+$/;
$position = 0 unless defined $position && $position =~ /^\d+$/;
my $size = -s $file;
$size = 0 unless defined $size;
my ($capacity, $grain, $eos) = (0, 128, 0);
my $fh;
if ($size >= 512 && open($fh, '<:raw', $file)) {
  my $hdr = '';
  if (sysread($fh, $hdr, 512) == 512 && substr($hdr, 0, 4) eq 'KDMV') {
    my $cap = unpack('Q<', substr($hdr, 12, 8));
    my $gs = unpack('Q<', substr($hdr, 20, 8));
    my $overhead = unpack('Q<', substr($hdr, 64, 8));
    if ($cap > 0 && $gs > 0) {
      $capacity = $cap * 512;
      $grain = $gs;
      my $start = $overhead * 512;
      $pos = $start if $pos < $start;
      while ($pos + 16 <= $size) {
        my $m = '';
        last unless sysseek($fh, $pos, 0);
        last unless sysread($fh, $m, 16) == 16;
        my ($val, $len, $type) = unpack('Q< L< L<', $m);
        if ($len > 0) {
          my $next = $pos + int(($len + 12 + 511) / 512) * 512;
          last if $next > $size;
          my $end = ($val + $grain) * 512;
          $end = $capacity if $end > $capacity;
          $position = $end if $end > $position;
          $pos = $next;
        } elsif ($type == 0) {
          $eos = 1;
          $pos += 512;
          last;
        } else {
          my $next = $pos + 512 + $val * 512;
          last if $next > $size;
          $pos = $next;
        }
      }
    }
  }
  close($fh);
}
printf("size=%d pos=%d position=%d capacity=%d eos=%d\n", $size, $pos, $position, $capacity, $eos);
`

export interface NfcStreamProbe {
  /** Bytes of stream on the node's filesystem. */
  size: number
  /** Offset to resume the walk from on the next call. */
  pos: number
  /** Bytes of the disk already streamed, in disk order. */
  position: number
  /** Disk capacity from the stream header, 0 until the header is complete. */
  capacity: number
  /** The end-of-stream marker has been written: the export is complete. */
  eos: boolean
}

const q = (arg: string) => "'" + arg.replaceAll("'", "'\\''") + "'"

/** Shell command running the probe on the node. Prints PROBE_FAILED when perl or the file is missing. */
export function probeCommand(scriptPath: string, filePath: string, pos: number, position: number): string {
  const n = (v: number) => String(Math.max(0, Math.floor(v)))
  return `perl ${q(scriptPath)} ${q(filePath)} ${n(pos)} ${n(position)} 2>/dev/null || echo PROBE_FAILED`
}

export function parseNfcStreamProbe(output: string): NfcStreamProbe | null {
  const m = /size=(\d+) pos=(\d+) position=(\d+) capacity=(\d+) eos=([01])/.exec(output || "")
  if (!m) return null
  return {
    size: Number.parseInt(m[1], 10),
    pos: Number.parseInt(m[2], 10),
    position: Number.parseInt(m[3], 10),
    capacity: Number.parseInt(m[4], 10),
    eos: m[5] === "1",
  }
}
